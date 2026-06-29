import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, sizedOr, decimalAs, warn } from '../../modules/type-mapping';

const types = makeDialectTypeFns({
  label: 'MySQL',
  // MySQL/MariaDB numeric types carry display-width and unsigned/zerofill modifiers.
  normalizeName: (n) => n.replace(/\s+(unsigned|signed|zerofill)\b/g, '').trim(),
  parseMap: {
    // tinyint(1) is the conventional boolean; wider tinyints are small ints
    tinyint: (tok) => (tok.length === 1 ? 'boolean' : 'smallint'),
    bool: 'boolean',
    boolean: 'boolean',
    smallint: 'smallint',
    mediumint: 'integer',
    int: 'integer',
    integer: 'integer',
    bigint: 'bigint',
    decimal: 'decimal',
    numeric: 'decimal',
    dec: 'decimal',
    float: 'real',
    double: 'double',
    'double precision': 'double',
    real: 'double',
    char: 'char',
    varchar: 'varchar',
    tinytext: 'text',
    text: 'text',
    mediumtext: 'text',
    longtext: 'text',
    enum: 'text',
    set: 'text',
    binary: 'binary',
    varbinary: 'varbinary',
    tinyblob: 'blob',
    blob: 'blob',
    mediumblob: 'blob',
    longblob: 'blob',
    date: 'date',
    time: 'time',
    year: 'smallint',
    datetime: 'timestamp',
    timestamp: 'timestamp',
    json: 'json',
  },
  renderMap: {
    boolean: plain('tinyint(1)'),
    smallint: plain('smallint'),
    integer: plain('int'),
    bigint: plain('bigint'),
    decimal: decimalAs('decimal'),
    real: plain('float'),
    double: plain('double'),
    char: sized('char'),
    varchar: sizedOr('varchar', 'varchar(255)', 'MySQL VARCHAR requires a length; defaulted to varchar(255)'),
    text: plain('text'),
    binary: sized('binary'),
    varbinary: sizedOr('varbinary', 'varbinary(255)', 'MySQL VARBINARY requires a length; defaulted to varbinary(255)'),
    blob: plain('blob'),
    date: plain('date'),
    time: plain('time'),
    timestamp: plain('datetime'),
    timestamptz: warn('timestamp', 'MySQL TIMESTAMP is stored as UTC; review timezone semantics'),
    uuid: warn('char(36)', 'MySQL has no uuid type; mapped to char(36)'),
    json: plain('json'),
    xml: warn('longtext', 'MySQL has no xml type; mapped to longtext'),
  },
});

const mysqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` AUTO_INCREMENT` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [`ALTER TABLE ${tableName} MODIFY COLUMN ${colName} ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP ${colName};`;
  },

  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[] {
    // MySQL 8 / MariaDB 10.2+ support literal column defaults via ALTER COLUMN.
    return defaultValue
      ? [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DEFAULT ${defaultValue};`]
      : [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP DEFAULT;`];
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    return [`ALTER TABLE ${tableName} DROP PRIMARY KEY;`];
  },

  ...types,
};

export const mysqlSqlDialect: SqlDialect = mysqlDialect;
export const mariadbSqlDialect: SqlDialect = mysqlDialect;
