import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, sizedOr, decimalAs, warn } from '../../modules/type-mapping';

const types = makeDialectTypeFns({
  label: 'SQL Server',
  parseMap: {
    bit: 'boolean',
    tinyint: 'smallint',
    smallint: 'smallint',
    int: 'integer',
    bigint: 'bigint',
    decimal: 'decimal',
    numeric: 'decimal',
    money: 'decimal',
    smallmoney: 'decimal',
    real: 'real',
    float: 'double',
    char: 'char',
    nchar: 'char',
    // (max) variants are unbounded LOBs → text
    varchar: (tok) => (tok.lengthIsMax ? 'text' : 'varchar'),
    nvarchar: (tok) => (tok.lengthIsMax ? 'text' : 'varchar'),
    text: 'text',
    ntext: 'text',
    binary: 'binary',
    varbinary: (tok) => (tok.lengthIsMax ? 'blob' : 'varbinary'),
    image: 'blob',
    date: 'date',
    time: 'time',
    datetime: 'timestamp',
    datetime2: 'timestamp',
    smalldatetime: 'timestamp',
    datetimeoffset: 'timestamptz',
    uniqueidentifier: 'uuid',
    xml: 'xml',
  },
  renderMap: {
    boolean: plain('bit'),
    smallint: plain('smallint'),
    integer: plain('int'),
    bigint: plain('bigint'),
    decimal: decimalAs('decimal'),
    real: plain('real'),
    double: plain('float'),
    char: sized('char'),
    varchar: sizedOr('varchar', 'varchar(255)', 'SQL Server VARCHAR needs a length; defaulted to varchar(255)'),
    text: plain('nvarchar(max)'),
    binary: sized('binary'),
    varbinary: sizedOr('varbinary', 'varbinary(max)'),
    blob: plain('varbinary(max)'),
    date: plain('date'),
    time: plain('time'),
    timestamp: plain('datetime2'),
    timestamptz: plain('datetimeoffset'),
    uuid: plain('uniqueidentifier'),
    json: warn('nvarchar(max)', 'SQL Server has no json type; mapped to nvarchar(max)'),
    xml: plain('xml'),
  },
});

export const sqlServerSqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` IDENTITY(1,1)` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[] {
    // SQL Server defaults are named constraints; changing one needs the existing
    // constraint's name (not available here), so flag it for manual handling.
    const action = defaultValue ? `set DEFAULT ${defaultValue}` : 'drop the DEFAULT';
    return [`-- review: ${colName}: ${action} — SQL Server requires dropping the existing DEFAULT constraint by name first, then ALTER TABLE ${tableName} ADD DEFAULT ... FOR ${colName}`];
  },

  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[] {
    const constraint = pkName ?? `PK_${tableName.replace(/^.*\./, '')}`;
    return [`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraint};`];
  },

  ...types,
};
