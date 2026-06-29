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

export const db2SqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DATA TYPE ${col.type};`];
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

  ...types,
};
