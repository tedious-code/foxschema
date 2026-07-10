import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas } from '../../cores/schema-to-tables';
import {
  SchemaProvider,
  ConnectionOptions,
  DbSchema,
  DbTable,
  DbColumn,
  DbView,
  DbSequence,
  DbUserType,
  DbForeignKey,
  DbUniqueConstraint,
  DbIndex,
  TableSchema,
} from '../../interfaces';

// DuckDB catalog result shapes (information_schema + duckdb_* table functions).
interface DkTableRaw { table_name: string; table_type: string; }
interface DkColumnRaw { table_name: string; column_name: string; ordinal_position: number; data_type: string; is_nullable: string; column_default: string | null; }
interface DkConstraintRaw {
  table_name: string; constraint_name: string; constraint_type: string;
  constraint_column_names: { items: string[] } | string[];
  referenced_table: string | null;
  referenced_column_names: { items: string[] } | string[] | null;
}
interface DkIndexRaw { table_name: string; index_name: string; is_unique: boolean; is_primary: boolean; }
interface DkViewRaw { view_name: string; sql: string | null; }
interface DkSequenceRaw { sequence_name: string; start_value: string | number; min_value: string | number; max_value: string | number; increment_by: string | number; cycle: boolean; }
interface DkEnumRaw { type_name: string; labels: { items: string[] } | string[]; }

/** DuckDB LIST columns come back as { items: [...] } via the node-api. */
function listItems(v: { items: string[] } | string[] | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : v.items ?? [];
}

export class DuckDbProvider implements SchemaProvider {
  readonly provider = 'duckdb';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    try {
      await ConnectionFactory.executeQuery(this.provider, options, 'SELECT 1');
      return true;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<{ schema_name: string }>(
      this.provider,
      options,
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('information_schema','pg_catalog','system','temp')
       ORDER BY schema_name`
    );
    return rows.map((r) => r.schema_name);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    const s = schema || options.schema || 'main';
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    const [rawTables, rawCols, rawConstraints, rawIndexes, rawViews, rawSequences, rawEnums] = await Promise.all([
      exec<DkTableRaw>(
        `SELECT table_name, table_type FROM information_schema.tables
         WHERE table_schema = ? ORDER BY table_name`, [s]),
      exec<DkColumnRaw>(
        `SELECT table_name, column_name, ordinal_position, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_schema = ? ORDER BY table_name, ordinal_position`, [s]),
      exec<DkConstraintRaw>(
        `SELECT table_name, constraint_name, constraint_type, constraint_column_names,
                referenced_table, referenced_column_names
         FROM duckdb_constraints()
         WHERE schema_name = ? AND constraint_type IN ('PRIMARY KEY','FOREIGN KEY','UNIQUE')`, [s]),
      exec<DkIndexRaw>(
        `SELECT table_name, index_name, is_unique, is_primary FROM duckdb_indexes()
         WHERE schema_name = ?`, [s]),
      exec<DkViewRaw>(
        `SELECT view_name, sql FROM duckdb_views() WHERE schema_name = ? AND NOT internal ORDER BY view_name`, [s]),
      exec<DkSequenceRaw>(
        `SELECT sequence_name, start_value, min_value, max_value, increment_by, cycle
         FROM duckdb_sequences() WHERE schema_name = ? ORDER BY sequence_name`, [s]),
      exec<DkEnumRaw>(
        // DuckDB also lists an anonymous 'enum' type (labels NULL) per column of
        // enum type — filter to the named user enums (labels present).
        `SELECT type_name, labels FROM duckdb_types()
         WHERE schema_name = ? AND logical_type = 'ENUM' AND labels IS NOT NULL
           AND type_name <> 'enum' ORDER BY type_name`, [s]),
    ]);

    const tableNames = new Set(rawTables.filter((t) => t.table_type === 'BASE TABLE').map((t) => t.table_name));
    const viewNames = new Set(rawTables.filter((t) => t.table_type === 'VIEW').map((t) => t.table_name));

    const tables: Record<string, DbTable> = {};
    const columns: Record<string, DbColumn[]> = {};
    const primaryKeys: Record<string, string[]> = {};
    const foreignKeys: Record<string, DbForeignKey[]> = {};
    const uniqueConstraints: Record<string, DbUniqueConstraint[]> = {};
    const indexes: Record<string, DbIndex[]> = {};
    const views: Record<string, DbView[]> = {};
    const sequences: Record<string, DbSequence[]> = {};
    const userTypes: Record<string, DbUserType[]> = {};

    // 1. Tables (skeleton)
    for (const name of tableNames) {
      tables[name] = { name, columns: {}, primaryKey: [], foreignKeys: [], uniqueConstraints: [], indexes: [] };
      columns[name] = [];
    }

    // 2. Columns (tables + views)
    const viewColsByName: Record<string, Record<string, DbColumn>> = {};
    for (const c of rawCols) {
      const mapped: DbColumn = {
        name: c.column_name,
        type: c.data_type.toLowerCase(),
        nullable: c.is_nullable === 'YES',
        defaultValue: c.column_default ?? undefined,
      };
      if (tableNames.has(c.table_name)) {
        tables[c.table_name].columns[c.column_name] = mapped;
        columns[c.table_name].push(mapped);
      } else if (viewNames.has(c.table_name)) {
        (viewColsByName[c.table_name] ??= {})[c.column_name] = { ...mapped, defaultValue: undefined };
      }
    }

    // 3. Constraints — PK / FK / UNIQUE (skip DuckDB's NOT-NULL "CHECK" pseudo-constraints)
    for (const c of rawConstraints) {
      const cols = listItems(c.constraint_column_names);
      const t = tables[c.table_name];
      if (!t) continue;
      if (c.constraint_type === 'PRIMARY KEY') {
        t.primaryKey.push(...cols);
        (primaryKeys[c.table_name] ??= []).push(...cols);
      } else if (c.constraint_type === 'FOREIGN KEY') {
        const fk: DbForeignKey = {
          name: c.constraint_name || `fk_${c.table_name}`,
          columns: cols,
          referencedSchema: '',
          referencedTable: c.referenced_table ?? '',
        };
        t.foreignKeys.push(fk);
        (foreignKeys[c.table_name] ??= []).push(fk);
      } else if (c.constraint_type === 'UNIQUE') {
        const uc: DbUniqueConstraint = { name: c.constraint_name || `uq_${c.table_name}`, columns: cols };
        t.uniqueConstraints.push(uc);
        (uniqueConstraints[c.table_name] ??= []).push(uc);
      }
    }

    // 4. Indexes (user-created only — skip PK/UNIQUE auto-indexes)
    for (const ix of rawIndexes) {
      if (ix.is_primary) continue;
      const idx: DbIndex = { name: ix.index_name, uniqueRule: ix.is_unique ? 'U' : 'D', columns: [] };
      if (tables[ix.table_name]) tables[ix.table_name].indexes.push(idx);
      (indexes[ix.table_name] ??= []).push(idx);
    }

    // 5. Views. duckdb_views().sql is the FULL "CREATE VIEW name AS <body>;" —
    // strip the header (and trailing ;) so `definition` is just the SELECT body,
    // matching what the other providers store and what the generator expects.
    for (const vw of rawViews) {
      const body = (vw.sql ?? '')
        .replace(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?VIEW\s+[\s\S]*?\s+AS\s+/i, '')
        .replace(/;\s*$/, '')
        .trim();
      (views[vw.view_name] ??= []).push({
        name: vw.view_name,
        schema: s,
        definition: body,
        columns: viewColsByName[vw.view_name] ?? {},
        indexes: [],
      });
    }

    // 6. Sequences
    for (const seq of rawSequences) {
      (sequences[seq.sequence_name] ??= []).push({
        name: seq.sequence_name,
        schema: s,
        startValue: String(seq.start_value),
        increment: String(seq.increment_by),
        minValue: String(seq.min_value),
        maxValue: String(seq.max_value),
        cycle: !!seq.cycle,
      });
    }

    // 7. Enum types
    for (const e of rawEnums) {
      (userTypes[e.type_name] ??= []).push({
        name: e.type_name,
        schema: s,
        metaType: 'E',
        attributes: listItems(e.labels).map((l) => ({ name: l, type: '' })),
      });
    }

    return {
      tables,
      columns,
      functions: {}, // DuckDB has no stored functions/procedures/triggers
      procedures: {},
      triggers: {},
      sequences,
      userTypes,
      primaryKeys: primaryKeys as Record<string, any[]>,
      foreignKeys,
      uniqueConstraints,
      indexes,
      indexColumns: {},
      views,
    };
  }
}
