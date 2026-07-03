import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas, rolesToTableSchemas, roleSkippedWarning } from '../../cores/schema-to-tables';
import {
  SchemaProvider,
  RoleLoadResult,
  DbRole,
  DbRoleMember,
  ConnectionOptions,
  DbSchema,
  DbTable,
  DbColumn,
  DbProcedure,
  DbTrigger,
  DbSequence,
  DbUserType,
  DbPrimaryKey,
  DbForeignKey,
  DbUniqueConstraint,
  DbIndex,
  DbIndexColumn,
  DbView,
  TableSchema,
  RoutineParameter,
  RoutineParameterMode,
} from '../../interfaces';

/**
 * sys.default_constraints.definition wraps every value in extra parentheses:
 *   ('active')  → 'active'
 *   ((0))       → 0
 *   (getdate()) → getdate()
 * Strip all leading/trailing paren pairs so the generator emits valid DEFAULT values.
 */
function normalizeSSDefault(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  let v = raw.trim();
  while (v.startsWith('(') && v.endsWith(')')) v = v.slice(1, -1).trim();
  return v || undefined;
}

// sys catalog raw shapes (column names from mssql come out with original casing)
interface SsTableRaw { table_name: string; }
interface SsColumnRaw { table_name: string; column_name: string; ordinal: number; type_name: string; max_length: number; precision: number; scale: number; is_nullable: boolean; is_identity: boolean; default_value: string | null; is_view: boolean; }
interface SsPkRaw { table_name: string; constraint_name: string; column_name: string; col_seq: number; }
interface SsFkRaw { table_name: string; constraint_name: string; column_name: string; ref_schema: string; ref_table: string; col_seq: number; }
interface SsUcRaw { table_name: string; constraint_name: string; column_name: string; col_seq: number; }
interface SsIndexRaw { table_name: string; index_name: string; is_primary_key: boolean; is_unique: boolean; is_unique_constraint: boolean; column_name: string; col_seq: number; }
interface SsViewRaw { view_name: string; definition: string; }
interface SsTriggerRaw { trigger_name: string; table_name: string; timing: string; event: string; definition: string; }
interface SsRoutineRaw { name: string; obj_type: string; definition: string; param_id: number | null; param_name: string | null; param_type: string | null; param_max_length: number; param_precision: number; param_scale: number; is_output: boolean; }
interface SsSequenceRaw { seq_name: string; data_type: string; start_value: string; increment: string; min_value: string; max_value: string; cycle: boolean; cache_size: string | null; }
interface SsUserTypeRaw { type_name: string; base_type: string; max_length: number; precision: number; scale: number; }

function fmtType(typeName: string, maxLength: number, precision: number, scale: number): string {
  const t = typeName.toLowerCase();
  if (['varchar', 'char', 'binary', 'varbinary'].includes(t)) {
    return maxLength === -1 ? `${t}(max)` : `${t}(${maxLength})`;
  }
  if (['nvarchar', 'nchar'].includes(t)) {
    return maxLength === -1 ? `${t}(max)` : `${t}(${maxLength / 2})`;
  }
  if (['decimal', 'numeric'].includes(t)) {
    return `${t}(${precision},${scale})`;
  }
  if (['datetime2', 'datetimeoffset', 'time'].includes(t)) {
    return `${t}(${scale})`;
  }
  return t;
}

export class SqlServerProvider implements SchemaProvider {
  readonly provider: string = 'sqlserver';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    try {
      await ConnectionFactory.executeQuery(this.provider, options, 'SELECT 1 AS n');
      return true;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const systemSchemas = `'sys','guest','INFORMATION_SCHEMA','db_owner','db_accessadmin','db_securityadmin','db_ddladmin','db_backupoperator','db_datareader','db_datawriter','db_denydatareader','db_denydatawriter'`;
    const rows = await ConnectionFactory.executeQuery<{ name: string }>(
      this.provider,
      options,
      `SELECT name FROM sys.schemas WHERE name NOT IN (${systemSchemas}) ORDER BY name`
    );
    return rows.map((r) => r.name);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  /**
   * Database-level roles and their members from `sys.database_principals` /
   * `sys.database_role_members`. Fixed roles and `public` are excluded. Readable
   * by most users, but degrades to a warning if VIEW DEFINITION is withheld.
   */
  async getRoles(options: ConnectionOptions, _schema: string): Promise<RoleLoadResult> {
    try {
      const rows = await ConnectionFactory.executeQuery<{ role_name: string; member: string | null; member_type: string | null }>(
        this.provider,
        options,
        `SELECT r.name AS role_name, m.name AS member, m.type_desc AS member_type
         FROM sys.database_principals r
         LEFT JOIN sys.database_role_members rm ON rm.role_principal_id = r.principal_id
         LEFT JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
         WHERE r.type = 'R' AND r.is_fixed_role = 0 AND r.name <> 'public'
         ORDER BY r.name, m.name`
      );
      const byRole = new Map<string, DbRoleMember[]>();
      for (const r of rows) {
        const members = byRole.get(r.role_name) ?? [];
        if (r.member) members.push({ grantee: r.member, granteeType: (r.member_type ?? '').includes('ROLE') ? 'ROLE' : 'USER' });
        byRole.set(r.role_name, members);
      }
      const roles: DbRole[] = [...byRole.entries()].map(([name, members]) => ({ name, members }));
      return { roles: rolesToTableSchemas(roles) };
    } catch (error) {
      return { roles: [], warning: roleSkippedWarning(this.provider, error) };
    }
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    const s = schema || options.schema || 'dbo';
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    const [
      rawTables,
      rawCols,
      rawViewCols,
      rawPks,
      rawFks,
      rawUcs,
      rawIndexes,
      rawViews,
      rawTriggers,
      rawRoutines,
      rawSequences,
      rawUserTypes,
    ] = await Promise.all([
      exec<SsTableRaw>(
        `SELECT t.name AS table_name
         FROM sys.tables t JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         WHERE sc.name = @p0 AND t.is_ms_shipped = 0 ORDER BY t.name`,
        [s]
      ),
      exec<SsColumnRaw>(
        `SELECT t.name AS table_name, c.name AS column_name, c.column_id AS ordinal,
                tp.name AS type_name, c.max_length, c.precision, c.scale,
                c.is_nullable, c.is_identity,
                dc.definition AS default_value, CAST(0 AS bit) AS is_view
         FROM sys.columns c
         JOIN sys.tables t ON t.object_id = c.object_id
         JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         JOIN sys.types tp ON tp.user_type_id = c.user_type_id
         LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
         WHERE sc.name = @p0 AND t.is_ms_shipped = 0
         ORDER BY t.name, c.column_id`,
        [s]
      ),
      exec<SsColumnRaw>(
        `SELECT v.name AS table_name, c.name AS column_name, c.column_id AS ordinal,
                tp.name AS type_name, c.max_length, c.precision, c.scale,
                c.is_nullable, CAST(0 AS bit) AS is_identity, NULL AS default_value, CAST(1 AS bit) AS is_view
         FROM sys.columns c
         JOIN sys.views v ON v.object_id = c.object_id
         JOIN sys.schemas sc ON sc.schema_id = v.schema_id
         JOIN sys.types tp ON tp.user_type_id = c.user_type_id
         WHERE sc.name = @p0
         ORDER BY v.name, c.column_id`,
        [s]
      ),
      exec<SsPkRaw>(
        `SELECT t.name AS table_name, kc.name AS constraint_name,
                c.name AS column_name, ic.key_ordinal AS col_seq
         FROM sys.key_constraints kc
         JOIN sys.tables t ON t.object_id = kc.parent_object_id
         JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
         JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
         WHERE kc.type = 'PK' AND sc.name = @p0
         ORDER BY t.name, ic.key_ordinal`,
        [s]
      ),
      exec<SsFkRaw>(
        `SELECT t.name AS table_name, fk.name AS constraint_name,
                c.name AS column_name, rs.name AS ref_schema,
                rt.name AS ref_table, fkc.constraint_column_id AS col_seq
         FROM sys.foreign_keys fk
         JOIN sys.tables t ON t.object_id = fk.parent_object_id
         JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.columns c ON c.object_id = fk.parent_object_id AND c.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
         JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
         WHERE sc.name = @p0
         ORDER BY t.name, fk.name, fkc.constraint_column_id`,
        [s]
      ),
      exec<SsUcRaw>(
        `SELECT t.name AS table_name, kc.name AS constraint_name,
                c.name AS column_name, ic.key_ordinal AS col_seq
         FROM sys.key_constraints kc
         JOIN sys.tables t ON t.object_id = kc.parent_object_id
         JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
         JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
         WHERE kc.type = 'UQ' AND sc.name = @p0
         ORDER BY t.name, kc.name, ic.key_ordinal`,
        [s]
      ),
      exec<SsIndexRaw>(
        `SELECT t.name AS table_name, i.name AS index_name,
                i.is_primary_key, i.is_unique, i.is_unique_constraint,
                c.name AS column_name, ic.key_ordinal AS col_seq
         FROM sys.indexes i
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
         WHERE sc.name = @p0 AND i.type > 0 AND ic.is_included_column = 0
         ORDER BY t.name, i.name, ic.key_ordinal`,
        [s]
      ),
      exec<SsViewRaw>(
        `SELECT v.name AS view_name, sm.definition
         FROM sys.views v
         JOIN sys.schemas sc ON sc.schema_id = v.schema_id
         JOIN sys.sql_modules sm ON sm.object_id = v.object_id
         WHERE sc.name = @p0
         ORDER BY v.name`,
        [s]
      ),
      exec<SsTriggerRaw>(
        `SELECT tg.name AS trigger_name, t.name AS table_name,
                CASE WHEN tg.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END AS timing,
                LTRIM(RTRIM(
                  CASE WHEN OBJECTPROPERTY(tg.object_id,'ExecIsInsertTrigger')=1 THEN 'INSERT,' ELSE '' END +
                  CASE WHEN OBJECTPROPERTY(tg.object_id,'ExecIsUpdateTrigger')=1 THEN 'UPDATE,' ELSE '' END +
                  CASE WHEN OBJECTPROPERTY(tg.object_id,'ExecIsDeleteTrigger')=1 THEN 'DELETE,' ELSE '' END
                ), ',') AS event,
                sm.definition
         FROM sys.triggers tg
         JOIN sys.tables t ON t.object_id = tg.parent_id
         JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         JOIN sys.sql_modules sm ON sm.object_id = tg.object_id
         WHERE sc.name = @p0 AND tg.is_ms_shipped = 0
         ORDER BY t.name, tg.name`,
        [s]
      ),
      exec<SsRoutineRaw>(
        `SELECT o.name, o.type AS obj_type, sm.definition,
                p.parameter_id AS param_id, p.name AS param_name,
                tp.name AS param_type, p.max_length AS param_max_length,
                p.precision AS param_precision, p.scale AS param_scale,
                ISNULL(p.is_output, 0) AS is_output
         FROM sys.objects o
         JOIN sys.schemas sc ON sc.schema_id = o.schema_id
         JOIN sys.sql_modules sm ON sm.object_id = o.object_id
         LEFT JOIN sys.parameters p ON p.object_id = o.object_id AND p.parameter_id > 0
         LEFT JOIN sys.types tp ON tp.user_type_id = p.user_type_id
         WHERE sc.name = @p0 AND o.type IN ('P', 'FN', 'IF', 'TF')
         ORDER BY o.name, p.parameter_id`,
        [s]
      ),
      exec<SsSequenceRaw>(
        `SELECT s.name AS seq_name, tp.name AS data_type,
                CAST(s.start_value AS nvarchar(40)) AS start_value,
                CAST(s.increment AS nvarchar(40)) AS increment,
                CAST(s.minimum_value AS nvarchar(40)) AS min_value,
                CAST(s.maximum_value AS nvarchar(40)) AS max_value,
                s.is_cycling AS cycle,
                CAST(s.cache_size AS nvarchar(20)) AS cache_size
         FROM sys.sequences s
         JOIN sys.schemas sc ON sc.schema_id = s.schema_id
         JOIN sys.types tp ON tp.user_type_id = s.user_type_id
         WHERE sc.name = @p0
         ORDER BY s.name`,
        [s]
      ),
      exec<SsUserTypeRaw>(
        `SELECT t.name AS type_name, bt.name AS base_type,
                t.max_length, t.precision, t.scale
         FROM sys.types t
         JOIN sys.schemas sc ON sc.schema_id = t.schema_id
         JOIN sys.types bt ON bt.user_type_id = t.system_type_id AND bt.is_user_defined = 0
         WHERE sc.name = @p0 AND t.is_user_defined = 1 AND t.is_table_type = 0
         ORDER BY t.name`,
        [s]
      ),
    ]);

    const tables: Record<string, DbTable> = {};
    const columns: Record<string, DbColumn[]> = {};
    const functions: Record<string, DbProcedure[]> = {};
    const procedures: Record<string, DbProcedure[]> = {};
    const triggers: Record<string, DbTrigger[]> = {};
    const sequences: Record<string, DbSequence[]> = {};
    const userTypes: Record<string, DbUserType[]> = {};
    const primaryKeys: Record<string, DbPrimaryKey[]> = {};
    const foreignKeys: Record<string, DbForeignKey[]> = {};
    const uniqueConstraints: Record<string, DbUniqueConstraint[]> = {};
    const indexes: Record<string, DbIndex[]> = {};
    const indexColumns: Record<string, DbIndexColumn[]> = {};
    const views: Record<string, DbView[]> = {};

    // 1. Tables
    for (const t of rawTables) {
      tables[t.table_name] = { name: t.table_name, columns: {}, primaryKey: [], foreignKeys: [], uniqueConstraints: [], indexes: [] };
      columns[t.table_name] = [];
      primaryKeys[t.table_name] = [];
      foreignKeys[t.table_name] = [];
      uniqueConstraints[t.table_name] = [];
      indexes[t.table_name] = [];
    }

    // 2. Columns (tables + views share the same mapping)
    const mapColumn = (col: SsColumnRaw): DbColumn => ({
      name: col.column_name,
      type: fmtType(col.type_name, col.max_length, col.precision, col.scale),
      nullable: col.is_nullable,
      defaultValue: normalizeSSDefault(col.default_value),
      identity: col.is_identity,
      identityGeneration: col.is_identity ? 'ALWAYS' : undefined,
    });

    for (const col of rawCols) {
      const mapped = mapColumn(col);
      if (tables[col.table_name]) tables[col.table_name].columns[col.column_name] = mapped;
      (columns[col.table_name] ??= []).push(mapped);
    }

    // 3. PKs
    for (const pk of rawPks) {
      if (tables[pk.table_name]) tables[pk.table_name].primaryKey.push(pk.column_name);
      (primaryKeys[pk.table_name] ??= []).push({ name: pk.column_name, constName: pk.constraint_name, column: pk.column_name, colSeq: pk.col_seq });
    }

    // 4. FKs (grouped by constraint name)
    const fkGroups = new Map<string, { table: string; cols: string[]; rSchema: string; rTable: string }>();
    for (const fk of rawFks) {
      const g = fkGroups.get(fk.constraint_name) ?? { table: fk.table_name, cols: [], rSchema: fk.ref_schema, rTable: fk.ref_table };
      g.cols.push(fk.column_name);
      fkGroups.set(fk.constraint_name, g);
    }
    for (const [name, info] of fkGroups) {
      const mapped: DbForeignKey = { name, columns: info.cols, referencedSchema: info.rSchema, referencedTable: info.rTable };
      if (tables[info.table]) tables[info.table].foreignKeys.push(mapped);
      (foreignKeys[info.table] ??= []).push(mapped);
    }

    // 5. Unique constraints
    const ucGroups = new Map<string, { table: string; cols: string[] }>();
    for (const uc of rawUcs) {
      const g = ucGroups.get(uc.constraint_name) ?? { table: uc.table_name, cols: [] };
      g.cols.push(uc.column_name);
      ucGroups.set(uc.constraint_name, g);
    }
    for (const [name, info] of ucGroups) {
      const mapped: DbUniqueConstraint = { name, columns: info.cols };
      if (tables[info.table]) tables[info.table].uniqueConstraints.push(mapped);
      (uniqueConstraints[info.table] ??= []).push(mapped);
    }

    // 6. Indexes
    const idxCols = new Map<string, string[]>();
    const idxMeta = new Map<string, { table: string; isPrimary: boolean; isUnique: boolean; isConstraint: boolean }>();
    for (const ix of rawIndexes) {
      const id = `${ix.table_name}.${ix.index_name}`;
      const cols = idxCols.get(id) ?? [];
      cols.push(ix.column_name);
      idxCols.set(id, cols);
      if (!idxMeta.has(id)) idxMeta.set(id, { table: ix.table_name, isPrimary: ix.is_primary_key, isUnique: ix.is_unique, isConstraint: ix.is_unique_constraint });
      (indexColumns[ix.index_name] ??= []).push({ name: ix.index_name, colName: ix.column_name, colOrder: 'A', colSeq: ix.col_seq });
    }
    for (const [id, meta] of idxMeta) {
      const cols = idxCols.get(id) ?? [];
      const uniqueRule = meta.isPrimary ? 'P' : meta.isUnique ? 'U' : 'D';
      // Flag unique-constraint-backing indexes so the generator drops/creates them via
      // ALTER TABLE ADD/DROP CONSTRAINT (SQL Server forbids DROP INDEX on them).
      const mapped: DbIndex = { name: id.split('.')[1], uniqueRule, columns: cols, constraint: meta.isConstraint };
      if (tables[meta.table]) tables[meta.table].indexes.push(mapped);
      (indexes[meta.table] ??= []).push(mapped);
    }

    // 7. Views
    const viewColsByName: Record<string, DbColumn[]> = {};
    for (const col of rawViewCols) {
      (viewColsByName[col.table_name] ??= []).push(mapColumn(col));
    }
    for (const vw of rawViews) {
      const viewColumns: Record<string, DbColumn> = {};
      for (const c of viewColsByName[vw.view_name] ?? []) viewColumns[c.name] = c;
      // sys.sql_modules.definition returns the full "CREATE VIEW <name> AS SELECT ..."
      // statement AS WRITTEN — the identifier may be bracketed ([schema].[name]),
      // quoted ("schema"."name"), or bare (schema.name), with or without a schema
      // qualifier. Store only the SELECT body so the generator can re-emit it with
      // the correct target schema prefix (matching how MySQL/Postgres providers do).
      // An identifier is any of those three forms; the header is CREATE VIEW <id>[.<id>] [WITH opts] AS.
      // A leading `-- comment` line (or several) can precede CREATE when the view
      // was defined with a comment above it — consume those so the header still matches.
      // Named constant so the eslint-disable directive sits on the same line as the pattern.
      // eslint-disable-next-line security/detect-unsafe-regex -- false positive: anchored at ^; leading part is bounded comment/whitespace runs, each identifier alternative is a bounded negated class or \w+
      const VIEW_CREATE_RE = /^(?:\s*--[^\n]*\n)*\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:(?:\[[^\]]*\]|"[^"]*"|\w+)\s*\.\s*)?(?:\[[^\]]*\]|"[^"]*"|\w+)\s+(?:WITH\s+\w+(?:\s*,\s*\w+)*\s+)?AS\s+/i;
      const body = vw.definition.replace(VIEW_CREATE_RE, '').trim();
      (views[vw.view_name] ??= []).push({ name: vw.view_name, schema: s, definition: body, columns: viewColumns, indexes: [] });
    }

    // 8. Triggers
    for (const trg of rawTriggers) {
      const event = trg.event.replace(/,+$/, '').replace(/,/g, ' OR ');
      (triggers[trg.trigger_name] ??= []).push({ name: trg.trigger_name, schema: s, tableName: trg.table_name, event, timing: trg.timing, definition: trg.definition });
    }

    // 9. Functions & procedures (rows are repeated per parameter)
    const routineParams = new Map<string, RoutineParameter[]>();
    const routineMeta = new Map<string, { type: string; def: string }>();
    for (const r of rawRoutines) {
      if (!routineMeta.has(r.name)) routineMeta.set(r.name, { type: r.obj_type.trim(), def: r.definition });
      if (r.param_id != null && r.param_name) {
        const mode: RoutineParameterMode = r.is_output ? 'OUT' : 'IN';
        const list = routineParams.get(r.name) ?? [];
        list.push({ name: r.param_name.replace(/^@/, ''), type: fmtType(r.param_type ?? '', r.param_max_length, r.param_precision, r.param_scale), mode, ordinal: r.param_id });
        routineParams.set(r.name, list);
      }
    }
    for (const [name, meta] of routineMeta) {
      const mapped: DbProcedure = { name, schema: s, routineType: meta.type === 'P' ? 'PROCEDURE' : 'FUNCTION', definition: meta.def, functionType: meta.type === 'TF' || meta.type === 'IF' ? 'T' : undefined, parameters: routineParams.get(name) ?? [] };
      if (meta.type === 'P') (procedures[name] ??= []).push(mapped);
      else (functions[name] ??= []).push(mapped);
    }

    // 10. Sequences
    for (const seq of rawSequences) {
      (sequences[seq.seq_name] ??= []).push({ name: seq.seq_name, schema: s, dataType: seq.data_type, startValue: seq.start_value, increment: seq.increment, minValue: seq.min_value, maxValue: seq.max_value, cycle: seq.cycle, cache: seq.cache_size ? Number(seq.cache_size) : undefined });
    }

    // 11. User types (alias types)
    for (const ut of rawUserTypes) {
      (userTypes[ut.type_name] ??= []).push({ name: ut.type_name, schema: s, sourceType: fmtType(ut.base_type, ut.max_length, ut.precision, ut.scale), metaType: 'D' });
    }

    return { tables, columns, functions, procedures, triggers, sequences, userTypes, primaryKeys, foreignKeys, uniqueConstraints, indexes, indexColumns, views };
  }
}
