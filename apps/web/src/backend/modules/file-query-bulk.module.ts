/**
 * Dialect-aware bulk writers for Query-files / Import-into-credential.
 *
 * Baseline for all engines: chunked multi-row INSERT via sql.values.
 * SQLite also has a local better-sqlite3 multi-VALUES path.
 */
import {
  ConnectionFactory,
  quoteSqlIdentifier,
  renderSqlQuery,
  sqlTag,
  type ConnectionOptions,
} from '@foxschema/core';

export type InferredSqlType = 'INTEGER' | 'REAL' | 'TEXT';

/** Rows per multi-VALUES statement. Conservative for engines with param caps. */
export function bulkChunkSize(dialect: string): number {
  const d = dialect.toLowerCase();
  if (d === 'sqlserver' || d === 'azuresql' || d === 'oracle' || d === 'db2') return 50;
  if (d === 'mysql' || d === 'mariadb' || d === 'tidb') return 100;
  if (d === 'clickhouse') return 200;
  return 200;
}

export function sqlTypeForDialect(dialect: string, t: InferredSqlType): string {
  const d = dialect.toLowerCase();
  if (d === 'postgres' || d === 'redshift' || d === 'cockroachdb' || d === 'yugabytedb') {
    if (t === 'INTEGER') return 'BIGINT';
    if (t === 'REAL') return 'DOUBLE PRECISION';
    return 'TEXT';
  }
  if (d === 'mysql' || d === 'mariadb' || d === 'tidb') {
    if (t === 'INTEGER') return 'BIGINT';
    if (t === 'REAL') return 'DOUBLE';
    return 'TEXT';
  }
  if (d === 'sqlserver' || d === 'azuresql') {
    if (t === 'INTEGER') return 'BIGINT';
    if (t === 'REAL') return 'FLOAT';
    return 'NVARCHAR(MAX)';
  }
  if (d === 'oracle') {
    if (t === 'INTEGER') return 'NUMBER(19)';
    if (t === 'REAL') return 'BINARY_DOUBLE';
    return 'CLOB';
  }
  if (d === 'db2') {
    if (t === 'INTEGER') return 'BIGINT';
    if (t === 'REAL') return 'DOUBLE';
    return 'VARCHAR(32672)';
  }
  if (d === 'clickhouse') {
    if (t === 'INTEGER') return 'Int64';
    if (t === 'REAL') return 'Float64';
    return 'String';
  }
  // sqlite, duckdb, default
  return t;
}

export function inferColumnTypes(columns: string[], matrix: unknown[][]): InferredSqlType[] {
  return columns.map((_, i) => inferType(matrix.map((r) => r[i])));
}

function inferType(values: unknown[]): InferredSqlType {
  let sawReal = false;
  let sawInt = false;
  for (const v of values) {
    if (v == null || v === '') continue;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) sawInt = true;
      else sawReal = true;
      continue;
    }
    const s = String(v).trim();
    if (s === '') continue;
    if (/^[+-]?\d+$/.test(s)) {
      sawInt = true;
      continue;
    }
    // Split forms match the prior float grammar (incl. `123.` / `1.e10`) without
    // a single ReDoS-prone alternation (eslint security/detect-unsafe-regex).
    if (
      /^[+-]?\d+\.\d*$/.test(s) ||
      /^[+-]?\.\d+$/.test(s) ||
      /^[+-]?\d+\.\d*[eE][+-]?\d+$/.test(s) ||
      /^[+-]?\.\d+[eE][+-]?\d+$/.test(s) ||
      /^[+-]?\d+[eE][+-]?\d+$/.test(s)
    ) {
      sawReal = true;
      continue;
    }
    return 'TEXT';
  }
  if (sawReal) return 'REAL';
  if (sawInt) return 'INTEGER';
  return 'TEXT';
}

export function coerceCell(v: unknown, type: InferredSqlType): unknown {
  if (v == null || v === '') return null;
  if (type === 'INTEGER') {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (type === 'REAL') {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function buildCreateTableSql(
  dialect: string,
  tableName: string,
  columns: string[],
  types: InferredSqlType[]
): string {
  const cols = columns
    .map((c, i) => `${quoteSqlIdentifier(c, dialect)} ${sqlTypeForDialect(dialect, types[i]!)}`)
    .join(', ');
  return `CREATE TABLE ${quoteSqlIdentifier(tableName, dialect)} (${cols})`;
}

function matrixToObjects(
  columns: string[],
  matrix: unknown[][],
  types: InferredSqlType[]
): Record<string, unknown>[] {
  return matrix.map((row) => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      out[columns[i]!] = coerceCell(row[i], types[i]!);
    }
    return out;
  });
}

/**
 * Create table + chunked multi-row INSERT on any Fox dialect via ConnectionFactory.
 */
export async function bulkLoadIntoConnection(args: {
  dialect: string;
  option: ConnectionOptions;
  tableName: string;
  columns: string[];
  matrix: unknown[][];
  types?: InferredSqlType[];
  /** Drop table first when true. */
  replaceTable?: boolean;
}): Promise<{ rowCount: number; chunks: number }> {
  const { dialect, option, tableName, columns, matrix } = args;
  if (!columns.length) throw new Error('No columns to import');
  const types = args.types ?? inferColumnTypes(columns, matrix);
  const chunk = bulkChunkSize(dialect);

  const connection = await ConnectionFactory.create(dialect, option);
  let chunks = 0;
  try {
    if (args.replaceTable) {
      const drop = `DROP TABLE IF EXISTS ${quoteSqlIdentifier(tableName, dialect)}`;
      // Oracle/DB2 may not support IF EXISTS — best-effort.
      try {
        await ConnectionFactory.executeOnConnection(dialect, connection, drop);
      } catch {
        try {
          await ConnectionFactory.executeOnConnection(
            dialect,
            connection,
            `DROP TABLE ${quoteSqlIdentifier(tableName, dialect)}`
          );
        } catch {
          /* table may not exist */
        }
      }
    }

    const createSql = buildCreateTableSql(dialect, tableName, columns, types);
    await ConnectionFactory.executeOnConnection(dialect, connection, createSql);

    if (matrix.length === 0) return { rowCount: 0, chunks: 0 };

    const objects = matrixToObjects(columns, matrix, types);
    for (let i = 0; i < objects.length; i += chunk) {
      const slice = objects.slice(i, i + chunk);
      const query = sqlTag`INSERT INTO ${sqlTag.id(tableName)} ${sqlTag.values(slice, columns)}`;
      const rendered = renderSqlQuery(query, dialect);
      await ConnectionFactory.executeOnConnection(
        dialect,
        connection,
        rendered.text,
        rendered.params
      );
      chunks++;
    }
    return { rowCount: matrix.length, chunks };
  } finally {
    await ConnectionFactory.close(dialect, connection);
  }
}
