import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, decimalAs } from '../../modules/type-mapping';

const types = makeDialectTypeFns({
  label: 'SQLite',
  // SQLite uses type affinity, not strict types — map to the closest affinity keyword.
  parseMap: {
    boolean: 'boolean',
    bool: 'boolean',
    tinyint: 'smallint',
    smallint: 'smallint',
    int: 'integer',
    integer: 'integer',
    mediumint: 'integer',
    bigint: 'bigint',
    decimal: 'decimal',
    numeric: 'decimal',
    real: 'double',
    double: 'double',
    'double precision': 'double',
    float: 'double',
    char: 'char',
    varchar: 'varchar',
    'character varying': 'varchar',
    text: 'text',
    clob: 'text',
    blob: 'blob',
    date: 'date',
    datetime: 'timestamp',
    timestamp: 'timestamp',
  },
  renderMap: {
    boolean: plain('INTEGER'),
    smallint: plain('INTEGER'),
    integer: plain('INTEGER'),
    bigint: plain('INTEGER'),
    decimal: decimalAs('NUMERIC'),
    real: plain('REAL'),
    double: plain('REAL'),
    char: plain('TEXT'),
    varchar: sized('VARCHAR'),
    text: plain('TEXT'),
    binary: plain('BLOB'),
    varbinary: plain('BLOB'),
    blob: plain('BLOB'),
    // SQLite has no dedicated temporal/uuid/json/xml types — stored as TEXT
    date: plain('TEXT'),
    time: plain('TEXT'),
    timestamp: plain('TEXT'),
    timestamptz: plain('TEXT'),
    uuid: plain('TEXT'),
    json: plain('TEXT'),
    xml: plain('TEXT'),
  },
});

export const sqliteSqlDialect: SqlDialect = {
  identityClause(_c: ColumnSpec): string {
    // INTEGER PRIMARY KEY is implicitly autoincrement in SQLite — no extra keyword
    return '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    // SQLite ALTER COLUMN is only supported since 3.35.0 and limited
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  setDefaultStatements(tableName: string, colName: string, _defaultValue: string | undefined): string[] {
    // SQLite can't ALTER a column default in place; the table must be rebuilt.
    return [`-- review: ${colName}: SQLite cannot change a column default in place — recreate ${tableName} to apply it`];
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    // SQLite has no ALTER TABLE DROP PRIMARY KEY; must recreate the table
    return [`-- SQLite: recreate ${tableName} to change primary key`];
  },

  ...types,
};
