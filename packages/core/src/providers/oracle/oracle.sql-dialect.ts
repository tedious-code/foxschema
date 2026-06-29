import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, sizedOr, decimalAs, warn } from '../../modules/type-mapping';

const types = makeDialectTypeFns({
  label: 'Oracle',
  parseMap: {
    // NUMBER(p,0) is an integer; NUMBER(p,s>0) or bare NUMBER is decimal
    number: (tok) => (tok.scale && tok.scale > 0 ? 'decimal' : tok.precision !== undefined ? 'integer' : 'decimal'),
    integer: 'integer',
    int: 'integer',
    smallint: 'integer',
    float: 'real',
    binary_float: 'real',
    binary_double: 'double',
    char: 'char',
    nchar: 'char',
    varchar2: 'varchar',
    varchar: 'varchar',
    nvarchar2: 'varchar',
    clob: 'text',
    nclob: 'text',
    long: 'text',
    blob: 'blob',
    raw: 'varbinary',
    bfile: 'blob',
    date: 'date',
    timestamp: 'timestamp',
    'timestamp with time zone': 'timestamptz',
    'timestamp with local time zone': 'timestamptz',
    xmltype: 'xml',
  },
  renderMap: {
    boolean: warn('NUMBER(1)', 'Oracle (pre-23c) has no boolean type; mapped to NUMBER(1)'),
    smallint: plain('NUMBER(5)'),
    integer: plain('NUMBER(10)'),
    bigint: plain('NUMBER(19)'),
    decimal: decimalAs('NUMBER'),
    real: plain('BINARY_FLOAT'),
    double: plain('BINARY_DOUBLE'),
    char: sized('CHAR'),
    varchar: sizedOr('VARCHAR2', 'VARCHAR2(255)', 'Oracle VARCHAR2 requires a length; defaulted to VARCHAR2(255)'),
    text: plain('CLOB'),
    binary: sizedOr('RAW', 'RAW(2000)'),
    varbinary: sizedOr('RAW', 'RAW(2000)'),
    blob: plain('BLOB'),
    date: plain('DATE'),
    time: warn('TIMESTAMP', 'Oracle has no time-only type; mapped to TIMESTAMP'),
    timestamp: plain('TIMESTAMP'),
    timestamptz: plain('TIMESTAMP WITH TIME ZONE'),
    uuid: warn('VARCHAR2(36)', 'Oracle has no uuid type; mapped to VARCHAR2(36)'),
    json: warn('CLOB', 'Oracle (pre-21c) has no json type; mapped to CLOB'),
    xml: plain('XMLTYPE'),
  },
});

export const oracleSqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [`ALTER TABLE ${tableName} MODIFY ${colName} ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[] {
    // Oracle changes (and clears, via DEFAULT NULL) a column default through MODIFY.
    return [`ALTER TABLE ${tableName} MODIFY (${colName} DEFAULT ${defaultValue ?? 'NULL'});`];
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    return [`ALTER TABLE ${tableName} DROP PRIMARY KEY;`];
  },

  ...types,
};
