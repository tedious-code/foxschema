import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas, rolesToTableSchemas, groupRoleRows, roleSkippedWarning } from '../../cores/schema-to-tables';
import {
  SchemaProvider,
  RoleLoadResult,
  DbRole,
  ConnectionOptions,
  DbSchema,
  DbTable,
  DbColumn,
  DbProcedure,
  DbTrigger,
  DbView,
  DbPrimaryKey,
  DbForeignKey,
  DbUniqueConstraint,
  DbIndex,
  DbIndexColumn,
  DbSequence,
  TableSchema,
  RoutineParameter,
  RoutineParameterMode,
} from '../../interfaces';

const SQL_KEYWORDS = /^(current_timestamp|current_date|current_time|now|uuid|null|true|false)(\(\))?$/i;
const STRING_TYPES = /^(varchar|char|tinytext|text|mediumtext|longtext|enum|set|nchar|nvarchar)/i;

/**
 * MySQL's information_schema.COLUMNS.COLUMN_DEFAULT stores string defaults WITHOUT
 * surrounding quotes (e.g. DEFAULT 'active' → stored as 'active'). Numeric and
 * expression defaults are fine as-is. This helper re-adds quotes for string types.
 */
function normalizeDefault(columnType: string, raw: string | null): string | undefined {
  if (raw === null) return undefined;
  if (SQL_KEYWORDS.test(raw.trim())) return raw; // keyword / function
  if (raw.includes('(')) return raw; // expression
  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: fully anchored ^…$ with simple digit classes, cannot ReDoS
  if (/^\d+(\.\d+)?$/.test(raw)) return raw; // numeric literal
  if (raw.startsWith("'") || raw.startsWith('"')) return raw; // already quoted
  if (STRING_TYPES.test(columnType.trim())) return `'${raw.replace(/'/g, "''")}'`;
  return raw;
}

// information_schema raw shapes (column names normalized to lower-case by mysql2)
interface MyTableRaw { TABLE_NAME: string; TABLE_TYPE: string; }
interface MyColumnRaw { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null; EXTRA: string; COLUMN_KEY: string; ORDINAL_POSITION: number; COLLATION_NAME: string | null; }
interface MyKeyRaw { TABLE_NAME: string; CONSTRAINT_NAME: string; COLUMN_NAME: string; ORDINAL_POSITION: number; REFERENCED_TABLE_SCHEMA: string | null; REFERENCED_TABLE_NAME: string | null; }
interface MyIndexRaw { TABLE_NAME: string; INDEX_NAME: string; NON_UNIQUE: number; COLUMN_NAME: string; SEQ_IN_INDEX: number; COLLATION: string | null; }
interface MyViewRaw { TABLE_NAME: string; VIEW_DEFINITION: string; }
interface MyTriggerRaw { TRIGGER_NAME: string; EVENT_OBJECT_TABLE: string; ACTION_TIMING: string; EVENT_MANIPULATION: string; ACTION_STATEMENT: string; }
interface MyRoutineRaw { ROUTINE_NAME: string; ROUTINE_TYPE: string; DTD_IDENTIFIER: string | null; ROUTINE_DEFINITION: string | null; }
interface MyParamRaw { SPECIFIC_NAME: string; PARAMETER_NAME: string | null; DTD_IDENTIFIER: string; PARAMETER_MODE: string | null; ORDINAL_POSITION: number; ROUTINE_TYPE: string; }

export class MysqlProvider implements SchemaProvider {
  // Typed as string (not the literal) so MariadbProvider can override the id.
  readonly provider: string = 'mysql';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    try {
      await ConnectionFactory.executeQuery(this.provider, options, 'SELECT 1');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error testing ${this.provider} connection:`, error);
      throw new Error(message);
    }
  }

  // MySQL/MariaDB have no separate schema level — databases are the schemas.
  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<{ SCHEMA_NAME: string }>(
      this.provider,
      options,
      `SELECT SCHEMA_NAME
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
       ORDER BY SCHEMA_NAME`
    );
    return rows.map((r) => r.SCHEMA_NAME);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  /**
   * Server-global role grants. MySQL 8 stores them in `mysql.role_edges`, which
   * typically needs SELECT on the `mysql` database — a privilege most app users
   * lack, so this commonly degrades to a warning. MariaDB overrides `fetchRoles`.
   */
  protected async fetchRoles(options: ConnectionOptions): Promise<DbRole[]> {
    const rows = await ConnectionFactory.executeQuery<{ role_name: string; member: string | null }>(
      this.provider,
      options,
      `SELECT FROM_USER AS role_name, TO_USER AS member
       FROM mysql.role_edges
       ORDER BY FROM_USER, TO_USER`
    );
    return groupRoleRows(rows);
  }

  async getRoles(options: ConnectionOptions, _schema: string): Promise<RoleLoadResult> {
    try {
      return { roles: rolesToTableSchemas(await this.fetchRoles(options)) };
    } catch (error) {
      return { roles: [], warning: roleSkippedWarning(this.provider, error) };
    }
  }

  /**
   * MySQL has no native sequence object (only AUTO_INCREMENT columns), so this is a
   * no-op here. MariaDB (10.3+) has real CREATE SEQUENCE and overrides this.
   */
  protected async fetchSequences(_options: ConnectionOptions, _db: string): Promise<Record<string, DbSequence[]>> {
    return {};
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    // The "schema" is the database name for MySQL/MariaDB.
    const db = schema || options.database || options.schema || '';
    // Each query runs on its own pooled connection so they parallelize safely —
    // a single connection can't multiplex; every query qualifies by schema.
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    {
      const [
        rawTables,
        rawColumns,
        rawKeys,
        rawIndexes,
        rawViews,
        rawTriggers,
        rawRoutines,
        rawParams,
        sequences,
      ] = await Promise.all([
        exec<MyTableRaw>(
          `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
          [db]
        ),
        exec<MyColumnRaw>(
          `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY, ORDINAL_POSITION, COLLATION_NAME
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
          [db]
        ),
        exec<MyKeyRaw>(
          `SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION,
                  REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME
           FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
          [db]
        ),
        exec<MyIndexRaw>(
          `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
           FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
          [db]
        ),
        exec<MyViewRaw>(
          `SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS
           WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
          [db]
        ),
        exec<MyTriggerRaw>(
          `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT
           FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?
           ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`,
          [db]
        ),
        exec<MyRoutineRaw>(
          `SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION
           FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?
           ORDER BY ROUTINE_NAME`,
          [db]
        ),
        exec<MyParamRaw>(
          `SELECT SPECIFIC_NAME, PARAMETER_NAME, DTD_IDENTIFIER, PARAMETER_MODE, ORDINAL_POSITION, ROUTINE_TYPE
           FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA = ?
           ORDER BY SPECIFIC_NAME, ORDINAL_POSITION`,
          [db]
        ),
        this.fetchSequences(options, db),
      ]);

      const tables: Record<string, DbTable> = {};
      const columns: Record<string, DbColumn[]> = {};
      const functions: Record<string, DbProcedure[]> = {};
      const procedures: Record<string, DbProcedure[]> = {};
      const triggers: Record<string, DbTrigger[]> = {};
      const userTypes: Record<string, never[]> = {}; // MySQL/MariaDB have no user-defined types
      const primaryKeys: Record<string, DbPrimaryKey[]> = {};
      const foreignKeys: Record<string, DbForeignKey[]> = {};
      const uniqueConstraints: Record<string, DbUniqueConstraint[]> = {};
      const indexes: Record<string, DbIndex[]> = {};
      const indexColumns: Record<string, DbIndexColumn[]> = {};
      const views: Record<string, DbView[]> = {};

      // 1. Tables
      for (const t of rawTables) {
        tables[t.TABLE_NAME] = {
          name: t.TABLE_NAME,
          columns: {},
          primaryKey: [],
          foreignKeys: [],
          uniqueConstraints: [],
          indexes: [],
        };
        columns[t.TABLE_NAME] = [];
        primaryKeys[t.TABLE_NAME] = [];
        foreignKeys[t.TABLE_NAME] = [];
        uniqueConstraints[t.TABLE_NAME] = [];
        indexes[t.TABLE_NAME] = [];
      }

      // 2. Columns (COLUMN_TYPE is already the full type, e.g. varchar(255) unsigned)
      for (const col of rawColumns) {
        const mapped: DbColumn = {
          name: col.COLUMN_NAME,
          type: col.COLUMN_TYPE,
          nullable: col.IS_NULLABLE === 'YES',
          defaultValue: normalizeDefault(col.COLUMN_TYPE, col.COLUMN_DEFAULT),
          identity: /auto_increment/i.test(col.EXTRA),
          identityGeneration: /auto_increment/i.test(col.EXTRA) ? 'ALWAYS' : undefined,
          collation: col.COLLATION_NAME ?? undefined,
        };
        if (tables[col.TABLE_NAME]) tables[col.TABLE_NAME].columns[col.COLUMN_NAME] = mapped;
        (columns[col.TABLE_NAME] ??= []).push(mapped);
      }

      // 3. Keys — PRIMARY → PK; rows with a referenced table → FK (grouped per constraint)
      const fkGroups = new Map<string, { name: string; table: string; cols: string[]; rSchema: string; rTable: string }>();
      for (const k of rawKeys) {
        if (k.REFERENCED_TABLE_NAME) {
          const id = `${k.TABLE_NAME}.${k.CONSTRAINT_NAME}`;
          const g = fkGroups.get(id) ?? { name: k.CONSTRAINT_NAME, table: k.TABLE_NAME, cols: [], rSchema: k.REFERENCED_TABLE_SCHEMA ?? db, rTable: k.REFERENCED_TABLE_NAME };
          g.cols.push(k.COLUMN_NAME);
          fkGroups.set(id, g);
        } else if (k.CONSTRAINT_NAME === 'PRIMARY') {
          if (tables[k.TABLE_NAME]) tables[k.TABLE_NAME].primaryKey.push(k.COLUMN_NAME);
          (primaryKeys[k.TABLE_NAME] ??= []).push({
            name: k.COLUMN_NAME,
            constName: 'PRIMARY',
            column: k.COLUMN_NAME,
            colSeq: k.ORDINAL_POSITION,
          });
        }
      }
      for (const [, info] of fkGroups) {
        const mapped: DbForeignKey = { name: info.name, columns: info.cols, referencedSchema: info.rSchema, referencedTable: info.rTable };
        if (tables[info.table]) tables[info.table].foreignKeys.push(mapped);
        (foreignKeys[info.table] ??= []).push(mapped);
      }

      // 4. Indexes (STATISTICS): index_name 'PRIMARY' → 'P', NON_UNIQUE=0 → 'U', else 'D'.
      // Unique indexes also surface as unique constraints.
      const idxCols = new Map<string, string[]>();
      const idxMeta = new Map<string, { table: string; nonUnique: number; name: string }>();
      for (const ix of rawIndexes) {
        const id = `${ix.TABLE_NAME}.${ix.INDEX_NAME}`;
        const cols = idxCols.get(id) ?? [];
        cols.push(ix.COLUMN_NAME);
        idxCols.set(id, cols);
        if (!idxMeta.has(id)) idxMeta.set(id, { table: ix.TABLE_NAME, nonUnique: ix.NON_UNIQUE, name: ix.INDEX_NAME });
        (indexColumns[ix.INDEX_NAME] ??= []).push({ name: ix.INDEX_NAME, colName: ix.COLUMN_NAME, colOrder: 'A', colSeq: ix.SEQ_IN_INDEX });
      }
      for (const [id, meta] of idxMeta) {
        const cols = idxCols.get(id) ?? [];
        const uniqueRule = meta.name === 'PRIMARY' ? 'P' : meta.nonUnique === 0 ? 'U' : 'D';
        const mapped: DbIndex = { name: meta.name, uniqueRule, columns: cols };
        if (tables[meta.table]) tables[meta.table].indexes.push(mapped);
        (indexes[meta.table] ??= []).push(mapped);
        if (uniqueRule === 'U') {
          const uc: DbUniqueConstraint = { name: meta.name, columns: cols };
          if (tables[meta.table]) tables[meta.table].uniqueConstraints.push(uc);
          (uniqueConstraints[meta.table] ??= []).push(uc);
        }
      }

      // 5. Views
      for (const vw of rawViews) {
        const viewColumns: Record<string, DbColumn> = {};
        for (const c of columns[vw.TABLE_NAME] ?? []) viewColumns[c.name] = c;
        (views[vw.TABLE_NAME] ??= []).push({
          name: vw.TABLE_NAME,
          schema: db,
          definition: vw.VIEW_DEFINITION,
          columns: viewColumns,
          indexes: [],
        });
      }

      // 6. Triggers
      for (const trg of rawTriggers) {
        (triggers[trg.TRIGGER_NAME] ??= []).push({
          name: trg.TRIGGER_NAME,
          schema: db,
          tableName: trg.EVENT_OBJECT_TABLE,
          event: trg.EVENT_MANIPULATION,
          timing: trg.ACTION_TIMING,
          definition: trg.ACTION_STATEMENT,
        });
      }

      // 7. Routine parameters grouped by routine (ordinal 0 = function return type)
      const paramMode = (m: string | null): RoutineParameterMode =>
        m === 'OUT' ? 'OUT' : m === 'INOUT' ? 'INOUT' : 'IN';
      const routineParams = new Map<string, RoutineParameter[]>();
      for (const p of rawParams) {
        const list = routineParams.get(p.SPECIFIC_NAME) ?? [];
        list.push({
          name: p.PARAMETER_NAME ?? '',
          type: p.DTD_IDENTIFIER,
          mode: p.ORDINAL_POSITION === 0 ? 'RETURN' : paramMode(p.PARAMETER_MODE),
          ordinal: p.ORDINAL_POSITION,
        });
        routineParams.set(p.SPECIFIC_NAME, list);
      }

      // 8. Functions & procedures
      // ROUTINE_DEFINITION from information_schema only contains the body (BEGIN...END),
      // not the full CREATE statement. SHOW CREATE FUNCTION/PROCEDURE returns the complete,
      // executable DDL — always prefer it and fall back to the body-only if access is denied.
      const fullDefs = new Map<string, string>();
      await Promise.all(
        rawRoutines.map(async (r) => {
          try {
            const colKey = r.ROUTINE_TYPE === 'FUNCTION' ? 'Create Function' : 'Create Procedure';
            const rows = await exec<Record<string, string>>(
              `SHOW CREATE ${r.ROUTINE_TYPE} \`${db}\`.\`${r.ROUTINE_NAME}\``
            );
            const def = rows[0]?.[colKey];
            // Strip DEFINER so the statement is portable across environments
            if (def) fullDefs.set(r.ROUTINE_NAME, def.replace(/\bDEFINER\s*=\s*`[^`]*`@`[^`]*`\s*/i, ''));
          } catch {
            // No SHOW CREATE access — fall back to ROUTINE_DEFINITION body below
          }
        })
      );

      for (const r of rawRoutines) {
        const mapped: DbProcedure = {
          name: r.ROUTINE_NAME,
          schema: db,
          routineType: r.ROUTINE_TYPE,
          definition: fullDefs.get(r.ROUTINE_NAME) ?? r.ROUTINE_DEFINITION ?? undefined,
          parameters: routineParams.get(r.ROUTINE_NAME) ?? [],
        };
        if (r.ROUTINE_TYPE === 'PROCEDURE') (procedures[r.ROUTINE_NAME] ??= []).push(mapped);
        else (functions[r.ROUTINE_NAME] ??= []).push(mapped);
      }

      return {
        tables, columns, functions, procedures, triggers, sequences,
        userTypes: userTypes as Record<string, never[]>,
        primaryKeys, foreignKeys, uniqueConstraints, indexes, indexColumns, views,
      };
    }
  }
}
