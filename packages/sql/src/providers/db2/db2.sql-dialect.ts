import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface.js';
import { makeDialectTypeFns, plain, sized, sizedOr, decimalAs, temporalAs, warn } from '../../modules/type-mapping.js';

const types = makeDialectTypeFns({
  label: 'Db2',
  parseMap: {
    boolean: 'boolean',
    smallint: 'smallint',
    integer: 'integer',
    int: 'integer',
    bigint: 'bigint',
    decimal: 'decimal',
    numeric: 'decimal',
    decfloat: 'decimal',
    real: 'real',
    double: 'double',
    'double precision': 'double',
    float: 'double',
    character: 'char',
    char: 'char',
    graphic: 'char',
    varchar: 'varchar',
    'character varying': 'varchar',
    vargraphic: 'varchar',
    clob: 'text',
    dbclob: 'text',
    'long varchar': 'text',
    blob: 'blob',
    binary: 'binary',
    varbinary: 'varbinary',
    date: 'date',
    time: 'time',
    timestamp: 'timestamp',
    xml: 'xml',
  },
  renderMap: {
    boolean: plain('BOOLEAN'),
    smallint: plain('SMALLINT'),
    integer: plain('INTEGER'),
    bigint: plain('BIGINT'),
    // Db2's maximum DECIMAL precision is 31, not 38: DECIMAL(32,0) and above
    // are SQL0604N. Passing a source precision straight through therefore
    // broke any migration from an engine that allows more (Postgres numeric,
    // Oracle NUMBER, SQL Server DECIMAL all go to 38), and it broke at CREATE
    // TABLE time — after the plan had been reviewed and accepted.
    decimal: (t) => {
      const rendered = decimalAs('DECIMAL')(t);
      if (t.precision === undefined || t.precision <= 31) return rendered;
      const scale = Math.min(t.scale ?? 0, 31);
      return {
        sql: `DECIMAL(31${t.scale !== undefined ? `,${scale}` : ''})`,
        warning: `Db2 caps DECIMAL precision at 31; ${t.raw} narrowed to DECIMAL(31${
          t.scale !== undefined ? `,${scale}` : ''
        })`,
      };
    },
    real: plain('REAL'),
    double: plain('DOUBLE'),
    char: sized('CHAR'),
    varchar: sizedOr('VARCHAR', 'VARCHAR(255)', 'Db2 VARCHAR requires a length; defaulted to VARCHAR(255)'),
    text: plain('CLOB'),
    binary: sized('BINARY'),
    varbinary: sizedOr('VARBINARY', 'VARBINARY(255)', 'Db2 VARBINARY requires a length; defaulted to VARBINARY(255)'),
    blob: plain('BLOB'),
    date: plain('DATE'),
    time: plain('TIME'),
    timestamp: temporalAs('TIMESTAMP'),
    timestamptz: (t) => {
      const sql = t.length !== undefined ? `TIMESTAMP(${t.length})` : 'TIMESTAMP';
      return { sql, warning: 'Db2 has no timezone-aware timestamp; mapped to TIMESTAMP' };
    },
    uuid: warn('CHAR(36)', 'Db2 has no uuid type; mapped to CHAR(36)'),
    json: warn('CLOB', 'Db2 has no json type; mapped to CLOB'),
    xml: plain('XML'),
  },
});

// DB2 LUW has never supported DROP IF EXISTS syntax — use SQL PL CONTINUE HANDLER.
// SQLSTATE '42704' = "An undefined object or constraint name was detected."
function db2Drop(keyword: string, name: string): string {
  const safe = name.replace(/'/g, "''");
  return `BEGIN\n  DECLARE CONTINUE HANDLER FOR SQLSTATE '42704' BEGIN END;\n  EXECUTE IMMEDIATE 'DROP ${keyword} ${safe}';\nEND`;
}

/** Same tolerance for a constraint, which lives on ALTER TABLE rather than DROP. */
function db2DropConstraint(tableName: string, fkName: string): string {
  const safe = `ALTER TABLE ${tableName} DROP FOREIGN KEY ${fkName}`.replace(/'/g, "''");
  return `BEGIN\n  DECLARE CONTINUE HANDLER FOR SQLSTATE '42704' BEGIN END;\n  EXECUTE IMMEDIATE '${safe}';\nEND`;
}

export const db2SqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    // DB2 rejects adding a NOT NULL column to an existing (possibly non-empty)
    // table with no default (SQL0193N). `WITH DEFAULT` (no value) backfills
    // existing rows with the type's default (0 / '' / current timestamp), the
    // closest safe equivalent when the source column declares no default.
    const def = /\bNOT\s+NULL\b/i.test(colDef) && !/\bDEFAULT\b/i.test(colDef)
      ? `${colDef} WITH DEFAULT`
      : colDef;
    return `ALTER TABLE ${tableName} ADD ${def};`;
  },

  /**
   * Undo the `WITH DEFAULT` above once the rows are backfilled.
   *
   * Without this the new column keeps a default (`''`, `0`) the source column
   * never declared, so re-comparing straight after a *successful* migration
   * still reports the column as changed — the tool proposes the same migration
   * for ever and never converges. Verified on DB2 11.5: DROP DEFAULT is
   * accepted immediately after the ADD, needs no REORG in between, and leaves
   * the catalog default NULL, matching the source exactly.
   */
  afterAddColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    const sourceHadDefault = col.defaultValue !== undefined && col.defaultValue !== null;
    if (col.nullable || sourceHadDefault) return [];
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP DEFAULT;`];
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    const stmts = [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DATA TYPE ${col.type};`];
    // DB2 nullability is a separate clause — SET DATA TYPE does not carry it.
    stmts.push(col.nullable
      ? `ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP NOT NULL;`
      : `ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET NOT NULL;`);
    return stmts;
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  /**
   * DROP COLUMN (and some type changes) leave the table in *reorg-pending*.
   * `SELECT` still works, so nothing looks wrong — but every INSERT/UPDATE/
   * DELETE fails with SQL0668N reason code 7, and so does rebuilding the
   * table's indexes and keys, until REORG runs.
   *
   * Verified against DB2 11.5: after `ALTER TABLE … DROP COLUMN`, a SELECT
   * succeeded and an INSERT returned SQL0668N. Without this the migration
   * reports success and hands back a table nobody can write to.
   *
   * ADMIN_CMD is the callable form — plain `REORG TABLE` is a CLP command, not
   * SQL, and cannot be sent over a client connection.
   */
  postColumnChangeStatements(qualifiedTable: string): string[] {
    return [`CALL SYSPROC.ADMIN_CMD('REORG TABLE ${qualifiedTable.replace(/'/g, "''")}');`];
  },

  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[] {
    return defaultValue
      ? [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DEFAULT ${defaultValue};`]
      : [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP DEFAULT;`];
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    return [`ALTER TABLE ${tableName} DROP PRIMARY KEY;`];
  },

  dropForeignKeyStatement(tableName: string, fkName: string): string {
    // DB2 has no DROP CONSTRAINT IF EXISTS; DROP FOREIGN KEY is the native form.
    //
    // Wrapped in the same 42704 handler as the other drops, because the
    // constraint may already be gone by the time this runs: dropping a parent
    // table earlier in the plan takes its inbound foreign keys with it. Without
    // the handler that raised SQL0204N, and since DB2 has transactional DDL the
    // *whole* migration rolled back — a revert that reported no error and
    // changed nothing. The generic fallback says `DROP CONSTRAINT IF EXISTS`
    // for exactly this reason; this restores that tolerance for DB2.
    return `${db2DropConstraint(tableName, fkName)};`;
  },

  dropIndexStatement(indexName: string, qualifiedTable: string): string {
    const dot = qualifiedTable.indexOf('.');
    const prefix = dot >= 0 ? qualifiedTable.slice(0, dot + 1) : '';
    return `DROP INDEX ${prefix}${indexName};`;
  },

  dropTriggerStatement(triggerName: string, qualifiedTable: string): string {
    const dot = qualifiedTable.indexOf('.');
    const prefix = dot >= 0 ? qualifiedTable.slice(0, dot + 1) : '';
    return `DROP TRIGGER ${prefix}${triggerName};`;
  },

  dropTableStatement(name: string, _version?: string): string {
    return db2Drop('TABLE', name);
  },

  dropViewStatement(name: string, _version?: string): string {
    return db2Drop('VIEW', name);
  },

  dropSequenceStatement(name: string, _version?: string): string {
    return db2Drop('SEQUENCE', name);
  },

  dropFunctionStatement(name: string, _version?: string): string {
    return db2Drop('FUNCTION', name);
  },

  dropProcedureStatement(name: string, _version?: string): string {
    return db2Drop('PROCEDURE', name);
  },

  ...types,
};
