import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas } from '../../cores/schema-to-tables';
import {
  SchemaProvider,
  ConnectionOptions,
  DbSchema,
  DbTable,
  DbColumn,
  DbView,
  DbForeignKey,
  DbPrimaryKey,
  DbUniqueConstraint,
  DbIndex,
  DbIndexColumn,
  TableSchema,
} from '../../interfaces';

interface ChTableRaw { name: string; engine: string; }
interface ChViewRaw { name: string; definition: string; }
interface ChColumnRaw {
  table: string;
  name: string;
  position: number;
  type: string;
  is_in_primary_key: number | boolean;
  default_kind: string;
  default_expression: string;
}

/** Strip Nullable(...) and LowCardinality(...) wrappers, returning inner type + nullable flag. */
function unwrapChType(raw: string): { inner: string; nullable: boolean } {
  let t = raw.trim();
  let nullable = false;
  for (let i = 0; i < 3; i++) {
    if (t.startsWith('Nullable(') && t.endsWith(')')) { nullable = true; t = t.slice(9, -1).trim(); continue; }
    if (t.startsWith('LowCardinality(') && t.endsWith(')')) { t = t.slice(15, -1).trim(); continue; }
    break;
  }
  return { inner: t, nullable };
}

export class ClickHouseProvider implements SchemaProvider {
  readonly provider = 'clickhouse';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    try {
      await ConnectionFactory.executeQuery(this.provider, options, 'SELECT 1');
      return true;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<{ name: string }>(
      this.provider,
      options,
      `SELECT name FROM system.databases
       WHERE name NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA', '_temporary_and_external_tables')
       ORDER BY name`
    );
    return rows.map((r) => r.name);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    const db = schema || options.schema || options.database || 'default';
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    const [rawTables, rawViews, rawColumns] = await Promise.all([
      exec<ChTableRaw>(
        `SELECT name, engine FROM system.tables
         WHERE database = $1 AND engine NOT IN ('View', 'MaterializedView', 'LiveView', 'Window', 'Merge', 'Distributed')
         ORDER BY name`,
        [db]
      ),
      exec<ChViewRaw>(
        `SELECT name, as_select AS definition FROM system.tables
         WHERE database = $1 AND engine IN ('View', 'MaterializedView')
         ORDER BY name`,
        [db]
      ),
      exec<ChColumnRaw>(
        `SELECT table, name, position, type, is_in_primary_key, default_kind, default_expression
         FROM system.columns WHERE database = $1
         ORDER BY table, position`,
        [db]
      ),
    ]);

    const tables: Record<string, DbTable> = {};
    const columns: Record<string, DbColumn[]> = {};
    const primaryKeys: Record<string, DbPrimaryKey[]> = {};
    const foreignKeys: Record<string, DbForeignKey[]> = {};
    const views: Record<string, DbView[]> = {};
    const uniqueConstraints: Record<string, DbUniqueConstraint[]> = {};
    const indexes: Record<string, DbIndex[]> = {};
    const indexColumns: Record<string, DbIndexColumn[]> = {};

    // Init tables
    for (const t of rawTables) {
      tables[t.name] = { name: t.name, columns: {}, primaryKey: [], foreignKeys: [], uniqueConstraints: [], indexes: [] };
      columns[t.name] = [];
      primaryKeys[t.name] = [];
      foreignKeys[t.name] = [];
      uniqueConstraints[t.name] = [];
      indexes[t.name] = [];
    }

    // Columns — unwrap Nullable() and LowCardinality() wrappers
    for (const c of rawColumns) {
      const { inner, nullable } = unwrapChType(c.type);
      const isPk = !!c.is_in_primary_key;
      const col: DbColumn = {
        name: c.name,
        type: inner,
        nullable,
        defaultValue: c.default_kind === 'DEFAULT' ? c.default_expression || undefined : undefined,
        identity: false,
      };
      if (tables[c.table]) {
        tables[c.table].columns[c.name] = col;
        if (isPk) tables[c.table].primaryKey.push(c.name);
      }
      (columns[c.table] ??= []).push(col);
      if (isPk) {
        (primaryKeys[c.table] ??= []).push({ name: c.name, constName: 'PRIMARY_KEY', column: c.name, colSeq: c.position });
      }
    }

    // Views
    for (const v of rawViews) {
      const viewCols: Record<string, DbColumn> = {};
      for (const c of columns[v.name] ?? []) viewCols[c.name] = c;
      (views[v.name] ??= []).push({ name: v.name, schema: db, definition: v.definition ?? '', columns: viewCols, indexes: [] });
    }

    // these objects dont exists in Click house
    const functions: Record<string, never[]> = {};
    const procedures: Record<string, never[]> = {};
    const triggers: Record<string, never[]> = {};
    const sequences: Record<string, never[]> = {};
    const userTypes: Record<string, never[]> = {};
    
    return { tables, columns, functions, procedures, triggers, sequences, userTypes, primaryKeys, foreignKeys, views, uniqueConstraints, indexes, indexColumns };
  }
}
