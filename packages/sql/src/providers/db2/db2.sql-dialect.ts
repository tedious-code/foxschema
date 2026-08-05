import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, sizedOr, decimalAs, warn } from '../../modules/type-mapping';

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
    decimal: decimalAs('DECIMAL'),
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
    timestamp: plain('TIMESTAMP'),
    timestamptz: warn('TIMESTAMP', 'Db2 has no timezone-aware timestamp; mapped to TIMESTAMP'),
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
    return `ALTER TABLE ${tableName} DROP FOREIGN KEY ${fkName};`;
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
