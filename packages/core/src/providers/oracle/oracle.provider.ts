import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas, rolesToTableSchemas, groupRoleRows, roleSkippedWarning } from '../../cores/schema-to-tables';
import {
  SchemaProvider,
  RoleLoadResult,
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

// ALL_* catalog raw shapes (Oracle folds unquoted identifiers to UPPER)
interface OraTableRaw { TABLE_NAME: string; TABLESPACE_NAME: string | null; }
interface OraColumnRaw { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_ID: number; DATA_TYPE: string; DATA_LENGTH: number; DATA_PRECISION: number | null; DATA_SCALE: number | null; NULLABLE: string; DATA_DEFAULT: string | null; IDENTITY_COLUMN: string; COLLATION: string | null; }
interface OraConstraintRaw { CONSTRAINT_NAME: string; CONSTRAINT_TYPE: string; TABLE_NAME: string; R_CONSTRAINT_NAME: string | null; R_OWNER: string | null; }
interface OraConsColRaw { CONSTRAINT_NAME: string; TABLE_NAME: string; COLUMN_NAME: string; POSITION: number; }
interface OraIndexRaw { INDEX_NAME: string; TABLE_NAME: string; UNIQUENESS: string; }
interface OraIndColRaw { INDEX_NAME: string; TABLE_NAME: string; COLUMN_NAME: string; COLUMN_POSITION: number; }
interface OraViewRaw { VIEW_NAME: string; TEXT: string; }
interface OraViewColRaw { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_ID: number; DATA_TYPE: string; DATA_LENGTH: number; DATA_PRECISION: number | null; DATA_SCALE: number | null; NULLABLE: string; COLLATION?: string | null; }
interface OraTriggerRaw { TRIGGER_NAME: string; TABLE_NAME: string; TRIGGER_TYPE: string; TRIGGERING_EVENT: string; TRIGGER_BODY: string; }
interface OraSourceRaw { NAME: string; TYPE: string; TEXT: string; LINE: number; }
interface OraArgRaw { OBJECT_NAME: string; ARGUMENT_NAME: string | null; SEQUENCE: number; DATA_TYPE: string; IN_OUT: string; OBJECT_ID: number; }
interface OraSeqRaw { SEQUENCE_NAME: string; MIN_VALUE: string; MAX_VALUE: string; INCREMENT_BY: string; CYCLE_FLAG: string; CACHE_SIZE: string; }
interface OraTypeRaw { TYPE_NAME: string; TYPECODE: string; }
interface OraTypeAttrRaw { TYPE_NAME: string; ATTR_NAME: string; ATTR_TYPE_NAME: string; ATTR_NO: number; }
interface OraSchemaRaw { USERNAME: string; }

function fmtOraType(dataType: string, dataLength: number, precision: number | null, scale: number | null): string {
  const t = dataType.toUpperCase();
  if (['VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR', 'RAW'].includes(t)) return `${t}(${dataLength})`;
  if (['NUMBER', 'FLOAT'].includes(t)) {
    if (precision != null && scale != null) return `${t}(${precision},${scale})`;
    if (precision != null) return `${t}(${precision})`;
    return t;
  }
  if (['TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITH LOCAL TIME ZONE'].includes(t)) {
    return scale != null ? `${t}(${scale})` : t;
  }
  return t;
}

export class OracleProvider implements SchemaProvider {
  readonly provider = 'oracle';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    try {
      await ConnectionFactory.executeQuery(this.provider, options, 'SELECT 1 FROM DUAL');
      return true;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  async detectVersion(options: ConnectionOptions): Promise<string> {
    try {
      const rows = await ConnectionFactory.executeQuery<{ VERSION: string }>(
        this.provider, options, `SELECT VERSION FROM V$INSTANCE`
      );
      return rows[0]?.VERSION ?? '';
    } catch {
      return '';
    }
  }

  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<OraSchemaRaw>(
      this.provider,
      options,
      `SELECT USERNAME FROM ALL_USERS WHERE ORACLE_MAINTAINED = 'N' ORDER BY USERNAME`
    );
    return rows.map((r) => r.USERNAME);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  /**
   * Database roles and their grantees from the `DBA_*` views. These require
   * elevated privileges (e.g. SELECT_CATALOG_ROLE); a plain schema user will be
   * denied, in which case roles are skipped with a warning rather than failing.
   */
  async getRoles(options: ConnectionOptions, _schema: string): Promise<RoleLoadResult> {
    try {
      const rows = await ConnectionFactory.executeQuery<{ ROLE_NAME: string; MEMBER: string | null }>(
        this.provider,
        options,
        `SELECT r.ROLE AS ROLE_NAME, rp.GRANTEE AS MEMBER
         FROM DBA_ROLES r
         LEFT JOIN DBA_ROLE_PRIVS rp ON rp.GRANTED_ROLE = r.ROLE
         ORDER BY r.ROLE, rp.GRANTEE`
      );
      const norm = rows.map((r) => ({ role_name: r.ROLE_NAME, member: r.MEMBER }));
      return { roles: rolesToTableSchemas(groupRoleRows(norm)) };
    } catch (error) {
      return { roles: [], warning: roleSkippedWarning(this.provider, error) };
    }
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    const owner = (schema || options.schema || options.username || '').toUpperCase();
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    const [
      rawTables,
      rawColumns,
      rawViewCols,
      rawConstraints,
      rawConsCols,
      rawIndexes,
      rawIndCols,
      rawViews,
      rawTriggers,
      rawSource,
      rawArgs,
      rawSeqs,
      rawTypes,
      rawTypeAttrs,
    ] = await Promise.all([
      exec<OraTableRaw>(
        `SELECT TABLE_NAME, TABLESPACE_NAME FROM ALL_TABLES WHERE OWNER = :1 ORDER BY TABLE_NAME`,
        [owner]
      ),
      exec<OraColumnRaw>(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_ID, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT, IDENTITY_COLUMN, COLLATION
         FROM ALL_TAB_COLUMNS WHERE OWNER = :1 ORDER BY TABLE_NAME, COLUMN_ID`,
        [owner]
      ),
      exec<OraViewColRaw>(
        `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_ID, c.DATA_TYPE, c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE, c.NULLABLE, c.COLLATION
         FROM ALL_TAB_COLUMNS c JOIN ALL_VIEWS v ON v.VIEW_NAME = c.TABLE_NAME AND v.OWNER = c.OWNER
         WHERE c.OWNER = :1 ORDER BY c.TABLE_NAME, c.COLUMN_ID`,
        [owner]
      ),
      exec<OraConstraintRaw>(
        `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, TABLE_NAME, R_CONSTRAINT_NAME, R_OWNER
         FROM ALL_CONSTRAINTS WHERE OWNER = :1 AND CONSTRAINT_TYPE IN ('P','U','R') AND STATUS = 'ENABLED'
         ORDER BY TABLE_NAME, CONSTRAINT_TYPE, CONSTRAINT_NAME`,
        [owner]
      ),
      exec<OraConsColRaw>(
        `SELECT cc.CONSTRAINT_NAME, cc.TABLE_NAME, cc.COLUMN_NAME, cc.POSITION
         FROM ALL_CONS_COLUMNS cc JOIN ALL_CONSTRAINTS c ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER
         WHERE cc.OWNER = :1 AND c.CONSTRAINT_TYPE IN ('P','U','R')
         ORDER BY cc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.POSITION`,
        [owner]
      ),
      // Exclude indexes that back a PK/UNIQUE constraint: Oracle auto-creates
      // one per constraint (often sharing the constraint's system name), and the
      // constraint declaration in CREATE TABLE already produces it. Re-emitting a
      // CREATE INDEX on the same columns fails with ORA-01408 ("such column list
      // already indexed"). ALL_CONSTRAINTS.INDEX_NAME names the backing index.
      // NOTE: oracledb counts each :N occurrence as a separate bind, so the
      // repeated owner filter uses :2 with owner passed twice.
      exec<OraIndexRaw>(
        `SELECT INDEX_NAME, TABLE_NAME, UNIQUENESS FROM ALL_INDEXES
         WHERE TABLE_OWNER = :1 AND INDEX_TYPE NOT IN ('LOB','CLUSTER')
           AND INDEX_NAME NOT IN (
             SELECT INDEX_NAME FROM ALL_CONSTRAINTS
             WHERE OWNER = :2 AND CONSTRAINT_TYPE IN ('P','U') AND INDEX_NAME IS NOT NULL)
         ORDER BY TABLE_NAME, INDEX_NAME`,
        [owner, owner]
      ),
      exec<OraIndColRaw>(
        `SELECT ic.INDEX_NAME, ic.TABLE_NAME, ic.COLUMN_NAME, ic.COLUMN_POSITION
         FROM ALL_IND_COLUMNS ic JOIN ALL_INDEXES i ON i.INDEX_NAME = ic.INDEX_NAME AND i.TABLE_OWNER = ic.TABLE_OWNER
         WHERE ic.TABLE_OWNER = :1 AND i.INDEX_TYPE NOT IN ('LOB','CLUSTER')
           AND ic.INDEX_NAME NOT IN (
             SELECT INDEX_NAME FROM ALL_CONSTRAINTS
             WHERE OWNER = :2 AND CONSTRAINT_TYPE IN ('P','U') AND INDEX_NAME IS NOT NULL)
         ORDER BY ic.INDEX_NAME, ic.COLUMN_POSITION`,
        [owner, owner]
      ),
      exec<OraViewRaw>(
        `SELECT VIEW_NAME, DBMS_METADATA.GET_DDL('VIEW', VIEW_NAME, OWNER) AS TEXT
         FROM ALL_VIEWS WHERE OWNER = :1 ORDER BY VIEW_NAME`,
        [owner]
      ).catch(() =>
        exec<OraViewRaw>(
          `SELECT VIEW_NAME, SUBSTR(TEXT, 1, 4000) AS TEXT FROM ALL_VIEWS WHERE OWNER = :1 ORDER BY VIEW_NAME`,
          [owner]
        )
      ),
      exec<OraTriggerRaw>(
        `SELECT TRIGGER_NAME, TABLE_NAME, TRIGGER_TYPE, TRIGGERING_EVENT, TRIGGER_BODY
         FROM ALL_TRIGGERS WHERE OWNER = :1 ORDER BY TABLE_NAME, TRIGGER_NAME`,
        [owner]
      ),
      exec<OraSourceRaw>(
        `SELECT NAME, TYPE, TEXT, LINE FROM ALL_SOURCE
         WHERE OWNER = :1 AND TYPE IN ('PROCEDURE','FUNCTION')
         ORDER BY NAME, TYPE, LINE`,
        [owner]
      ),
      exec<OraArgRaw>(
        `SELECT OBJECT_NAME, ARGUMENT_NAME, SEQUENCE, DATA_TYPE, IN_OUT, OBJECT_ID
         FROM ALL_ARGUMENTS WHERE OWNER = :1 AND PACKAGE_NAME IS NULL
         ORDER BY OBJECT_NAME, SEQUENCE`,
        [owner]
      ),
      exec<OraSeqRaw>(
        `SELECT SEQUENCE_NAME, TO_CHAR(MIN_VALUE) AS MIN_VALUE, TO_CHAR(MAX_VALUE) AS MAX_VALUE,
                TO_CHAR(INCREMENT_BY) AS INCREMENT_BY, CYCLE_FLAG, TO_CHAR(CACHE_SIZE) AS CACHE_SIZE
         FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = :1
           AND SEQUENCE_NAME NOT LIKE 'ISEQ$$\\_%' ESCAPE '\\'
         ORDER BY SEQUENCE_NAME`,
        [owner]
      ),
      exec<OraTypeRaw>(
        `SELECT TYPE_NAME, TYPECODE FROM ALL_TYPES WHERE OWNER = :1 ORDER BY TYPE_NAME`,
        [owner]
      ),
      exec<OraTypeAttrRaw>(
        `SELECT TYPE_NAME, ATTR_NAME, ATTR_TYPE_NAME, ATTR_NO
         FROM ALL_TYPE_ATTRS WHERE OWNER = :1 ORDER BY TYPE_NAME, ATTR_NO`,
        [owner]
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
      tables[t.TABLE_NAME] = { name: t.TABLE_NAME, columns: {}, primaryKey: [], foreignKeys: [], uniqueConstraints: [], indexes: [], tablespace: t.TABLESPACE_NAME ?? undefined };
      columns[t.TABLE_NAME] = [];
      primaryKeys[t.TABLE_NAME] = [];
      foreignKeys[t.TABLE_NAME] = [];
      uniqueConstraints[t.TABLE_NAME] = [];
      indexes[t.TABLE_NAME] = [];
    }

    // 2. Columns (table columns only; view columns handled separately)
    const tableSet = new Set(Object.keys(tables));
    const mapOraCol = (col: OraColumnRaw | OraViewColRaw): DbColumn => {
      // Identity columns carry an internal DEFAULT of the form
      // "SCHEMA"."ISEQ$$_nnn".nextval — that's not a portable/re-emittable
      // default and referencing the system sequence in generated DDL fails
      // (ORA-02289). Represent them as GENERATED identity columns instead and
      // drop the internal default so the generator emits
      // `GENERATED ... AS IDENTITY` (via identityClause), not a nextval default.
      const isIdentity = (col as OraColumnRaw).IDENTITY_COLUMN === 'YES';
      // COLLATION is 'USING_NLS_COMP' when no explicit column-level collation was set
      // (the vast majority of columns) — that's Oracle's "use session/db defaults"
      // placeholder, not a real named collation, so treat it the same as absent.
      const collation = col.COLLATION && col.COLLATION !== 'USING_NLS_COMP' ? col.COLLATION : undefined;
      return {
        name: col.COLUMN_NAME,
        type: fmtOraType(col.DATA_TYPE, col.DATA_LENGTH, col.DATA_PRECISION, col.DATA_SCALE),
        nullable: col.NULLABLE === 'Y',
        defaultValue: isIdentity ? undefined : ((col as OraColumnRaw).DATA_DEFAULT?.trim() ?? undefined),
        identity: isIdentity || undefined,
        identityGeneration: isIdentity ? 'ALWAYS' : undefined,
        collation,
      };
    };

    for (const col of rawColumns) {
      if (!tableSet.has(col.TABLE_NAME)) continue; // skip view columns from ALL_TAB_COLUMNS
      const mapped = mapOraCol(col);
      tables[col.TABLE_NAME].columns[col.COLUMN_NAME] = mapped;
      (columns[col.TABLE_NAME] ??= []).push(mapped);
    }

    // 3. Constraints — build lookup: constraint_name → columns
    const consColMap = new Map<string, string[]>();
    for (const cc of rawConsCols) {
      const cols = consColMap.get(cc.CONSTRAINT_NAME) ?? [];
      cols.push(cc.COLUMN_NAME);
      consColMap.set(cc.CONSTRAINT_NAME, cols);
    }

    // Also build: constraint_name → table_name (for FK ref lookup)
    const consTableMap = new Map<string, string>();
    for (const con of rawConstraints) {
      if (!consTableMap.has(con.CONSTRAINT_NAME)) consTableMap.set(con.CONSTRAINT_NAME, con.TABLE_NAME);
    }

    for (const con of rawConstraints) {
      const cols = consColMap.get(con.CONSTRAINT_NAME) ?? [];
      if (con.CONSTRAINT_TYPE === 'P') {
        if (tables[con.TABLE_NAME]) tables[con.TABLE_NAME].primaryKey.push(...cols);
        (primaryKeys[con.TABLE_NAME] ??= []).push(...cols.map((c, i) => ({ name: c, constName: con.CONSTRAINT_NAME, column: c, colSeq: i + 1 })));
      } else if (con.CONSTRAINT_TYPE === 'U') {
        const mapped: DbUniqueConstraint = { name: con.CONSTRAINT_NAME, columns: cols };
        if (tables[con.TABLE_NAME]) tables[con.TABLE_NAME].uniqueConstraints.push(mapped);
        (uniqueConstraints[con.TABLE_NAME] ??= []).push(mapped);
      } else if (con.CONSTRAINT_TYPE === 'R') {
        // R_CONSTRAINT_NAME points to the PK/UK of the referenced table
        const refTable = con.R_CONSTRAINT_NAME ? (consTableMap.get(con.R_CONSTRAINT_NAME) ?? '') : '';
        const mapped: DbForeignKey = { name: con.CONSTRAINT_NAME, columns: cols, referencedSchema: con.R_OWNER ?? owner, referencedTable: refTable };
        if (tables[con.TABLE_NAME]) tables[con.TABLE_NAME].foreignKeys.push(mapped);
        (foreignKeys[con.TABLE_NAME] ??= []).push(mapped);
      }
    }

    // 4. Indexes + index columns
    const idxColsMap = new Map<string, string[]>();
    const idxTableMap = new Map<string, string>();
    for (const ic of rawIndCols) {
      const cols = idxColsMap.get(ic.INDEX_NAME) ?? [];
      cols.push(ic.COLUMN_NAME);
      idxColsMap.set(ic.INDEX_NAME, cols);
      if (!idxTableMap.has(ic.INDEX_NAME)) idxTableMap.set(ic.INDEX_NAME, ic.TABLE_NAME);
      (indexColumns[ic.INDEX_NAME] ??= []).push({ name: ic.INDEX_NAME, colName: ic.COLUMN_NAME, colOrder: 'A', colSeq: ic.COLUMN_POSITION });
    }
    for (const ix of rawIndexes) {
      const cols = idxColsMap.get(ix.INDEX_NAME) ?? [];
      // Detect if this index backs a PK constraint
      const isPk = tables[ix.TABLE_NAME]?.primaryKey.length > 0 && cols.every((c) => tables[ix.TABLE_NAME].primaryKey.includes(c)) && cols.length === tables[ix.TABLE_NAME].primaryKey.length;
      const uniqueRule = isPk ? 'P' : ix.UNIQUENESS === 'UNIQUE' ? 'U' : 'D';
      const mapped: DbIndex = { name: ix.INDEX_NAME, uniqueRule, columns: cols };
      if (tables[ix.TABLE_NAME]) tables[ix.TABLE_NAME].indexes.push(mapped);
      (indexes[ix.TABLE_NAME] ??= []).push(mapped);
    }

    // 5. Views
    const viewColsByName: Record<string, DbColumn[]> = {};
    for (const col of rawViewCols) {
      (viewColsByName[col.TABLE_NAME] ??= []).push(mapOraCol(col));
    }
    // DBMS_METADATA.GET_DDL returns the full
    //   CREATE OR REPLACE FORCE [NON]EDITIONABLE VIEW "SCHEMA"."NAME" ("C1",...) AS <select>
    // Strip that header so the generator re-emits just the SELECT via CREATE OR
    // REPLACE VIEW (otherwise the wrapped result is CREATE ... AS CREATE ... — ORA-00928).
    // (The ALL_VIEWS.TEXT fallback already returns just the SELECT, which this no-ops on.)
    // eslint-disable-next-line security/detect-unsafe-regex -- anchored at ^; each segment is a bounded token or negated class
    const ORA_VIEW_CREATE_RE = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FORCE\s+)?(?:(?:NON)?EDITIONABLE\s+)?VIEW\s+(?:"[^"]*"\s*\.\s*)?"[^"]*"\s*(?:\([^)]*\)\s*)?AS\s+/i;
    for (const vw of rawViews) {
      const viewColumns: Record<string, DbColumn> = {};
      for (const c of viewColsByName[vw.VIEW_NAME] ?? []) viewColumns[c.name] = c;
      const definition = String(vw.TEXT ?? '').replace(ORA_VIEW_CREATE_RE, '').trim();
      (views[vw.VIEW_NAME] ??= []).push({ name: vw.VIEW_NAME, schema: owner, definition, columns: viewColumns, indexes: [] });
    }

    // 6. Triggers
    for (const trg of rawTriggers) {
      (triggers[trg.TRIGGER_NAME] ??= []).push({ name: trg.TRIGGER_NAME, schema: owner, tableName: trg.TABLE_NAME, event: trg.TRIGGERING_EVENT, timing: trg.TRIGGER_TYPE, definition: trg.TRIGGER_BODY });
    }

    // 7. Functions & procedures (lines aggregated into full source)
    const sourceMap = new Map<string, { type: string; lines: string[] }>();
    for (const row of rawSource) {
      const entry = sourceMap.get(row.NAME) ?? { type: row.TYPE, lines: [] };
      entry.lines.push(row.TEXT);
      sourceMap.set(row.NAME, entry);
    }

    const argMap = new Map<string, OraArgRaw[]>();
    for (const arg of rawArgs) {
      const list = argMap.get(arg.OBJECT_NAME) ?? [];
      list.push(arg);
      argMap.set(arg.OBJECT_NAME, list);
    }

    const modeMap: Record<string, RoutineParameterMode> = { IN: 'IN', OUT: 'OUT', 'IN/OUT': 'INOUT' };
    for (const [name, { type, lines }] of sourceMap) {
      // ALL_SOURCE.TEXT starts at "FUNCTION name..."/"PROCEDURE name..." — the
      // CREATE [OR REPLACE] verb is NOT stored. Prepend it so the emitted DDL is
      // a valid CREATE statement (otherwise Oracle rejects it with ORA-00900).
      const rawBody = lines.join('').replace(/\s+$/, '');
      const definition = /^\s*(CREATE|FUNCTION|PROCEDURE)/i.test(rawBody)
        ? (/^\s*CREATE/i.test(rawBody) ? rawBody : `CREATE OR REPLACE ${rawBody}`)
        : rawBody;
      const args = argMap.get(name) ?? [];
      // ordinal=0 is the function return value (ARGUMENT_NAME is null)
      const parameters: RoutineParameter[] = args
        .filter((a) => a.SEQUENCE > 0)
        .map((a) => ({ name: a.ARGUMENT_NAME ?? '', type: a.DATA_TYPE, mode: modeMap[a.IN_OUT] ?? 'IN', ordinal: a.SEQUENCE }));
      const mapped: DbProcedure = { name, schema: owner, routineType: type, definition, parameters };
      if (type === 'PROCEDURE') (procedures[name] ??= []).push(mapped);
      else (functions[name] ??= []).push(mapped);
    }

    // 8. Sequences
    for (const seq of rawSeqs) {
      (sequences[seq.SEQUENCE_NAME] ??= []).push({ name: seq.SEQUENCE_NAME, schema: owner, startValue: seq.MIN_VALUE, increment: seq.INCREMENT_BY, minValue: seq.MIN_VALUE, maxValue: seq.MAX_VALUE, cycle: seq.CYCLE_FLAG === 'Y', cache: seq.CACHE_SIZE ? Number(seq.CACHE_SIZE) : undefined });
    }

    // 9. User types (object types)
    const typeAttrsByName = new Map<string, OraTypeAttrRaw[]>();
    for (const ta of rawTypeAttrs) {
      const list = typeAttrsByName.get(ta.TYPE_NAME) ?? [];
      list.push(ta);
      typeAttrsByName.set(ta.TYPE_NAME, list);
    }
    for (const ut of rawTypes) {
      const attrs = typeAttrsByName.get(ut.TYPE_NAME) ?? [];
      (userTypes[ut.TYPE_NAME] ??= []).push({ name: ut.TYPE_NAME, schema: owner, metaType: ut.TYPECODE === 'OBJECT' ? 'O' : 'D', attributes: attrs.map((a) => ({ name: a.ATTR_NAME, type: a.ATTR_TYPE_NAME })) });
    }

    return { tables, columns, functions, procedures, triggers, sequences, userTypes, primaryKeys, foreignKeys, uniqueConstraints, indexes, indexColumns, views };
  }
}
