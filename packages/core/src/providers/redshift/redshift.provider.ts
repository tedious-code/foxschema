import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas } from '../../cores/schema-to-tables';
import {
  SchemaProvider,
  ConnectionOptions,
  DbSchema,
  DbTable,
  DbColumn,
  DbProcedure,
  DbPrimaryKey,
  DbForeignKey,
  DbIndex,
  DbView,
  DbUniqueConstraint,
  DbIndexColumn,
  TableSchema,
  RoutineParameter,
  RoutineParameterMode,
} from '../../interfaces';

interface RsTableRaw { table_name: string; table_type: string; }
interface RsColumnRaw {
  table_name: string; column_name: string; ordinal_position: number;
  data_type: string; character_maximum_length: number | null;
  numeric_precision: number | null; numeric_scale: number | null;
  is_nullable: string; column_default: string | null;
}
interface RsPkRaw { table_name: string; constraint_name: string; column_name: string; ordinal_position: number; }
interface RsFkRaw {
  table_name: string; constraint_name: string; column_name: string;
  ref_schema: string; ref_table: string; ordinal_position: number;
}
interface RsViewRaw { view_name: string; definition: string | null; }
interface RsRoutineRaw { name: string; kind: string; definition: string | null; specific_name: string; }
interface RsParamRaw {
  specific_name: string; parameter_name: string | null;
  ordinal_position: number; data_type: string; parameter_mode: string;
}

function fmtType(dataType: string, charLen: number | null, numPrec: number | null, numScale: number | null): string {
  if (charLen !== null && charLen > 0) return `${dataType}(${charLen})`;
  if (numPrec !== null && numScale !== null) return `${dataType}(${numPrec},${numScale})`;
  return dataType;
}

export class RedshiftProvider implements SchemaProvider {
  readonly provider = 'redshift';

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
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_internal', 'catalog_history')
         AND schema_name NOT LIKE 'pg_%'
         AND schema_name NOT LIKE 'pg_temp_%'
       ORDER BY schema_name`
    );
    return rows.map((r) => r.schema_name);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    const schemaName = schema || options.schema || 'public';
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    const [rawTables, rawColumns, rawPks, rawFks, rawViews, rawRoutines, rawParams] = await Promise.all([
      exec<RsTableRaw>(
        `SELECT table_name, table_type FROM information_schema.tables
         WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW')
         ORDER BY table_name`,
        [schemaName]
      ),
      exec<RsColumnRaw>(
        `SELECT table_name, column_name, ordinal_position, data_type,
                character_maximum_length, numeric_precision, numeric_scale,
                is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1
         ORDER BY table_name, ordinal_position`,
        [schemaName]
      ),
      exec<RsPkRaw>(
        `SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
         WHERE tc.constraint_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY tc.table_name, kcu.ordinal_position`,
        [schemaName]
      ),
      exec<RsFkRaw>(
        `SELECT tc.table_name, tc.constraint_name, kcu.column_name,
                ccu.table_schema AS ref_schema, ccu.table_name AS ref_table,
                kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
         WHERE tc.constraint_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'
         ORDER BY tc.table_name, kcu.ordinal_position`,
        [schemaName]
      ),
      exec<RsViewRaw>(
        `SELECT table_name AS view_name, view_definition AS definition
         FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`,
        [schemaName]
      ),
      exec<RsRoutineRaw>(
        `SELECT routine_name AS name, routine_type AS kind, routine_definition AS definition, specific_name
         FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name`,
        [schemaName]
      ).catch(() => [] as RsRoutineRaw[]),
      exec<RsParamRaw>(
        `SELECT p.specific_name, p.parameter_name, p.ordinal_position, p.data_type, p.parameter_mode
         FROM information_schema.parameters p
         JOIN information_schema.routines r
           ON p.specific_name = r.specific_name AND p.specific_schema = r.routine_schema
         WHERE p.specific_schema = $1 ORDER BY p.specific_name, p.ordinal_position`,
        [schemaName]
      ).catch(() => [] as RsParamRaw[]),
    ]);

    const tables: Record<string, DbTable> = {};
    const columns: Record<string, DbColumn[]> = {};
    const primaryKeys: Record<string, DbPrimaryKey[]> = {};
    const foreignKeys: Record<string, DbForeignKey[]> = {};
    const views: Record<string, DbView[]> = {};
    const functions: Record<string, DbProcedure[]> = {};
    const procedures: Record<string, DbProcedure[]> = {};
    const triggers: Record<string, never[]> = {};
    const sequences: Record<string, never[]> = {};
    const userTypes: Record<string, never[]> = {};
    const uniqueConstraints: Record<string, DbUniqueConstraint[]> = {};
    const indexes: Record<string, DbIndex[]> = {};
    const indexColumns: Record<string, DbIndexColumn[]> = {};

    // Tables
    for (const t of rawTables) {
      if (t.table_type === 'BASE TABLE') {
        tables[t.table_name] = { name: t.table_name, columns: {}, primaryKey: [], foreignKeys: [], uniqueConstraints: [], indexes: [] };
        columns[t.table_name] = [];
        primaryKeys[t.table_name] = [];
        foreignKeys[t.table_name] = [];
        uniqueConstraints[t.table_name] = [];
        indexes[t.table_name] = [];
      }
    }

    // Columns
    for (const c of rawColumns) {
      const type = fmtType(c.data_type, c.character_maximum_length, c.numeric_precision, c.numeric_scale);
      const col: DbColumn = {
        name: c.column_name,
        type,
        nullable: c.is_nullable === 'YES',
        defaultValue: c.column_default ?? undefined,
        identity: c.column_default?.includes('"identity"') ?? false,
      };
      if (tables[c.table_name]) tables[c.table_name].columns[c.column_name] = col;
      (columns[c.table_name] ??= []).push(col);
    }

    // Primary keys
    for (const r of rawPks) {
      if (tables[r.table_name]) tables[r.table_name].primaryKey.push(r.column_name);
      (primaryKeys[r.table_name] ??= []).push({
        name: r.column_name,
        constName: r.constraint_name,
        column: r.column_name,
        colSeq: r.ordinal_position,
      });
    }

    // Foreign keys (group by constraint name)
    const fkGroups = new Map<string, { name: string; table: string; cols: string[]; rSchema: string; rTable: string }>();
    for (const r of rawFks) {
      const id = `${r.table_name}.${r.constraint_name}`;
      const g = fkGroups.get(id) ?? { name: r.constraint_name, table: r.table_name, cols: [], rSchema: r.ref_schema, rTable: r.ref_table };
      g.cols.push(r.column_name);
      fkGroups.set(id, g);
    }
    for (const [, info] of fkGroups) {
      const fk: DbForeignKey = { name: info.name, columns: info.cols, referencedSchema: info.rSchema, referencedTable: info.rTable };
      if (tables[info.table]) tables[info.table].foreignKeys.push(fk);
      (foreignKeys[info.table] ??= []).push(fk);
    }

    // Views
    for (const v of rawViews) {
      const viewCols: Record<string, DbColumn> = {};
      for (const c of columns[v.view_name] ?? []) viewCols[c.name] = c;
      (views[v.view_name] ??= []).push({ name: v.view_name, schema: schemaName, definition: v.definition ?? '', columns: viewCols, indexes: [] });
    }

    // Routines
    const paramsBySpecific = new Map<string, RoutineParameter[]>();
    for (const p of rawParams) {
      const mode = (p.parameter_mode?.toUpperCase() ?? 'IN') as RoutineParameterMode;
      const params = paramsBySpecific.get(p.specific_name) ?? [];
      params.push({ name: p.parameter_name ?? '', type: p.data_type, mode, ordinal: p.ordinal_position });
      paramsBySpecific.set(p.specific_name, params);
    }
    for (const r of rawRoutines) {
      const params = paramsBySpecific.get(r.specific_name) ?? [];
      const proc: DbProcedure = { name: r.name, schema: schemaName, routineType: r.kind === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION', definition: r.definition ?? '', parameters: params };
      if (r.kind === 'PROCEDURE') {
        (procedures[r.name] ??= []).push(proc);
      } else {
        (functions[r.name] ??= []).push(proc);
      }
    }

    return { tables, columns, functions, procedures, triggers, sequences, userTypes, primaryKeys, foreignKeys, views, uniqueConstraints, indexes, indexColumns };
  }
}
