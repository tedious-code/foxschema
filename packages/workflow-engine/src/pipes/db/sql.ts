/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQL against any database FoxSchema can connect to.
 *
 * `source.db.sql` runs a query, or a whole script as a SQL job, and emits the
 * rows the last statement returns. `sink.db.sql` writes the records it
 * receives: as inserts into a table, or by running a statement per record.
 *
 * Both go through `@foxschema/db` — the drivers, dialects and connection
 * options the rest of FoxSchema uses — which is imported the first time a SQL
 * pipe runs, so an engine that never runs SQL never loads a driver.
 *
 * Values never become SQL text. A `{{path}}` token is bound as a parameter in
 * the dialect's own placeholder style, and table and column names are quoted
 * for the dialect.
 */
import * as z from 'zod';
import {
  makeSqlQuery,
  maxInsertRows,
  quoteQualifiedName,
  renderSqlQuery,
  splitSqlStatements,
  sqlTag,
  type RenderedSql,
} from '@foxschema/sql';
import { getPath } from '../../common/index.js';
import type { PipeContext, RecordBatch, SinkPipe, SourcePipe } from '../../registry/index.js';
import {
  batchSizeField,
  definePipeMetadata,
  splitTemplate,
  type PipeMetadata,
} from '../../sdk/index.js';
import { requirePipeSecret, templateScope } from '../pipe-context.js';

/** A connection as a database credential resolves to it. */
export interface SqlConnection {
  dialect: string;
  schema?: string;
  option: Record<string, unknown>;
}

/** One open database session. */
export interface SqlSession {
  query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]>;
  /** Runs `work` in a transaction where the dialect can roll one back; otherwise just runs it. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Opens a session. `dedicated` asks for a connection of its own rather than
 * one from the pool: a transaction must not share its connection.
 */
export type SqlRunner = (
  connection: SqlConnection,
  options: { dedicated: boolean },
) => Promise<SqlSession>;

const foxSchemaDrivers: SqlRunner = async ({ dialect, schema, option }, { dedicated }) => {
  const db = await import('@foxschema/db');
  const adapter = db.getAdapter(dialect);
  const handle = await db.ConnectionFactory.create(dialect, option as never, { pooled: !dedicated });
  try {
    if (schema) await adapter.setCurrentSchema(handle, schema);
  } catch (error) {
    await db.ConnectionFactory.close(dialect, handle);
    throw error;
  }
  const canRollBack = db.dialectSupportsTransactionalRollback(dialect);
  return {
    query: (sql, params) => adapter.query<Record<string, unknown>>(handle, sql, params),
    async transaction(work) {
      if (!canRollBack) return work();
      await adapter.beginTransaction(handle);
      try {
        const result = await work();
        await adapter.commitTransaction(handle);
        return result;
      } catch (error) {
        // The statement's own error is the one worth reporting.
        await adapter.rollbackTransaction(handle).catch(() => undefined);
        throw error;
      }
    },
    close: () => db.ConnectionFactory.close(dialect, handle),
  };
};

const connectionFields = {
  /** Which database a credential entered in the engine is for. A saved FoxSchema connection already says. */
  dialect: z.string().min(1).optional(),
  /** Overrides the schema the credential names. */
  schema: z.string().min(1).optional(),
};

async function connectionFor(
  context: PipeContext,
  config: { dialect?: string; schema?: string },
): Promise<SqlConnection> {
  const secret = await requirePipeSecret(context, 'a database credential');

  // A saved FoxSchema connection resolves to { dialect, schema, option }; a
  // credential entered in the engine is the option bag itself.
  const { dialect: secretDialect, schema: secretSchema, option, ...rest } = secret;
  const dialect = typeof secretDialect === 'string' && secretDialect ? secretDialect : config.dialect;
  if (!dialect) {
    throw new Error(
      `credential ${context.pipe.credentialId} does not say which database it is for; set dialect`,
    );
  }
  const schema = config.schema ?? (typeof secretSchema === 'string' ? secretSchema : undefined);
  return {
    dialect,
    ...(schema ? { schema } : {}),
    option: option && typeof option === 'object' ? (option as Record<string, unknown>) : rest,
  };
}

/** A split template with every `{{path}}` bound as a parameter: split once, bound per use. */
function bindTemplate(
  { strings, paths }: ReturnType<typeof splitTemplate>,
  scope: Record<string, unknown>,
  dialect: string,
): RenderedSql {
  return renderSqlQuery(
    makeSqlQuery(strings, paths.map((path) => getPath(scope, path) ?? null)),
    dialect,
  );
}

/**
 * The statements of a script, without terminators. A PL/SQL block keeps its
 * `END;` — Oracle needs it — while a plain statement's `;` is dropped, since
 * several drivers refuse one.
 */
function statementsOf(script: string): string[] {
  return splitSqlStatements(script)
    .filter((statement) => statement.kind === 'sql')
    .map((statement) => statement.text.trim())
    .map((text) => (/\bEND\s*;$/i.test(text) ? text : text.replace(/;\s*$/, '')))
    .filter((text) => text.length > 0);
}

async function withSession<T>(
  open: SqlRunner,
  connection: SqlConnection,
  transactional: boolean,
  work: (session: SqlSession) => Promise<T>,
): Promise<T> {
  const session = await open(connection, { dedicated: transactional });
  try {
    return transactional ? await session.transaction(() => work(session)) : await work(session);
  } finally {
    await session.close();
  }
}

const sourceConfigSchema = z.object({
  /** One statement, or a script whose statements run in order. The last statement's rows are emitted. */
  sql: z.string().min(1),
  ...connectionFields,
  /** Run the script all-or-nothing, where the database can roll back. */
  transaction: z.boolean().default(false),
  ...batchSizeField({ max: 10_000 }),
});

export class SqlSourcePipe implements SourcePipe {
  readonly type = 'source.db.sql';
  readonly role = 'source';

  constructor(private readonly open: SqlRunner = foxSchemaDrivers) {}

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'SQL query',
      category: 'Source/Database',
      family: 'database',
      tags: ['sql', 'query', 'job', 'script'],
      version: '0.1.0',
      role: 'source',
      inputs: [],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: sourceConfigSchema,
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    sourceConfigSchema.parse(config);
  }

  async *read(context: PipeContext): AsyncIterable<RecordBatch> {
    const config = sourceConfigSchema.parse(context.pipe.config);
    const statements = statementsOf(config.sql);
    if (statements.length === 0) throw new Error('sql holds no statements');
    const connection = await connectionFor(context, config);
    const scope = templateScope(context);

    const rows = await withSession(this.open, connection, config.transaction, async (session) => {
      let last: Record<string, unknown>[] = [];
      for (const statement of statements) {
        const { text, params } = bindTemplate(splitTemplate(statement), scope, connection.dialect);
        last = await session.query(text, params);
      }
      return last;
    });

    for (let offset = 0; offset < rows.length; offset += config.batchSize) {
      yield {
        id: `${context.pipe.id}:0:${offset}`,
        partitionId: '0',
        records: rows.slice(offset, offset + config.batchSize),
      };
    }
  }
}

function insertStatements(
  records: Record<string, unknown>[],
  table: string,
  configuredColumns: string[],
  dialect: string,
): RenderedSql[] {
  const columns = configuredColumns.length > 0 ? configuredColumns : Object.keys(records[0]!);
  if (columns.length === 0) throw new Error('the records have no fields to insert');
  const target = quoteQualifiedName(table, dialect);
  if (!target) throw new Error(`table is not a usable name: ${table}`);

  const perStatement = maxInsertRows(dialect, columns.length);
  const statements: RenderedSql[] = [];
  for (let start = 0; start < records.length; start += perStatement) {
    const rows = records.slice(start, start + perStatement);
    statements.push(
      renderSqlQuery(makeSqlQuery([`INSERT INTO ${target} `, ''], [sqlTag.values(rows, columns)]), dialect),
    );
  }
  return statements;
}

/** The statement once per record, its template split once for the whole batch. */
function recordStatements(
  records: Record<string, unknown>[],
  sql: string,
  scope: Record<string, unknown>,
  dialect: string,
): RenderedSql[] {
  const template = splitTemplate(sql);
  return records.map((record) => bindTemplate(template, { ...scope, record }, dialect));
}

const sinkConfigSchema = z
  .object({
    /** `insert` writes records into `table`; `statement` runs `sql` once per record. */
    mode: z.enum(['insert', 'statement']).default('insert'),
    /** Target table, optionally schema-qualified. */
    table: z.string().min(1).optional(),
    /** Columns to write, in order. Empty takes every field of the batch's first record. */
    columns: z.array(z.string().min(1)).default([]),
    /** Statement per record; `{{record.field}}` binds a field. */
    sql: z.string().min(1).optional(),
    ...connectionFields,
    /** Write each batch all-or-nothing, where the database can roll back. */
    transaction: z.boolean().default(true),
  })
  .refine((config) => config.mode !== 'insert' || config.table, {
    message: 'insert mode needs a table',
    path: ['table'],
  })
  .refine((config) => config.mode !== 'statement' || config.sql, {
    message: 'statement mode needs sql',
    path: ['sql'],
  });

export class SqlSinkPipe implements SinkPipe {
  readonly type = 'sink.db.sql';
  readonly role = 'sink';

  constructor(private readonly open: SqlRunner = foxSchemaDrivers) {}

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'SQL write',
      category: 'Output/Database',
      family: 'database',
      tags: ['sql', 'insert', 'write'],
      version: '0.1.0',
      role: 'sink',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [],
      configSchema: sinkConfigSchema,
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    sinkConfigSchema.parse(config);
  }

  async write(batch: RecordBatch, context: PipeContext): Promise<void> {
    if (batch.records.length === 0) return;
    const config = sinkConfigSchema.parse(context.pipe.config);
    const connection = await connectionFor(context, config);
    const scope = templateScope(context);
    const statements =
      config.mode === 'insert'
        ? insertStatements(batch.records, config.table!, config.columns, connection.dialect)
        : recordStatements(batch.records, config.sql!, scope, connection.dialect);

    await withSession(this.open, connection, config.transaction, async (session) => {
      for (const statement of statements) await session.query(statement.text, statement.params);
    });
  }
}
