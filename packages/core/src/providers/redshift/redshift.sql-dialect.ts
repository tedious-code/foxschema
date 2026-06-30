import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, decimalAs } from '../../modules/type-mapping';

// Redshift type system is a subset of Postgres. information_schema returns
// standard SQL type names, so the mapping mirrors the Postgres dialect.
const types = makeDialectTypeFns({
  label: 'Redshift',
  parseMap: {
    boolean: 'boolean',
    bool: 'boolean',
    smallint: 'smallint',
    int2: 'smallint',
    integer: 'integer',
    int: 'integer',
    int4: 'integer',
    bigint: 'bigint',
    int8: 'bigint',
    numeric: 'decimal',
    decimal: 'decimal',
    real: 'real',
    float4: 'real',
    'double precision': 'double',
    float: 'double',
    float8: 'double',
    character: 'char',
    char: 'char',
    bpchar: 'char',
    'character varying': 'varchar',
    varchar: 'varchar',
    nvarchar: 'varchar',
    text: 'text',
    date: 'date',
    time: 'time',
    'time without time zone': 'time',
    timestamp: 'timestamp',
    'timestamp without time zone': 'timestamp',
    'timestamp with time zone': 'timestamptz',
    timestamptz: 'timestamptz',
    super: 'json',
  },
  renderMap: {
    boolean: plain('boolean'),
    smallint: plain('smallint'),
    integer: plain('integer'),
    bigint: plain('bigint'),
    decimal: decimalAs('numeric'),
    real: plain('real'),
    double: plain('double precision'),
    char: sized('char'),
    varchar: sized('varchar'),
    text: plain('varchar(max)'),
    binary: plain('varbyte'),
    varbinary: plain('varbyte'),
    blob: plain('varbyte'),
    date: plain('date'),
    time: plain('time'),
    timestamp: plain('timestamp'),
    timestamptz: plain('timestamptz'),
    uuid: plain('varchar(36)'),
    json: plain('super'),
    xml: plain('varchar(max)'),
  },
});

export const redshiftSqlDialect: SqlDialect = {
  // Redshift uses IDENTITY(seed, step) on the column, not GENERATED ALWAYS AS IDENTITY
  identityClause(c: ColumnSpec): string {
    return c.identity ? ' IDENTITY(0,1)' : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`;
  },

  // Redshift does not support ALTER COLUMN type changes on existing rows — flag for review
  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [
      `-- review: Redshift does not support ALTER COLUMN type changes in-place.`,
      `-- To change ${tableName}.${colName} to ${col.type}: recreate the table or add a new column and backfill.`,
    ];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[] {
    if (defaultValue) {
      return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DEFAULT ${defaultValue};`];
    }
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP DEFAULT;`];
  },

  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[] {
    const constraint = pkName ?? `PK_${tableName.replace(/^.*\./, '')}`;
    return [`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraint};`];
  },

  dropIndexStatement(indexName: string, qualifiedTable: string): string {
    const dot = qualifiedTable.indexOf('.');
    const prefix = dot >= 0 ? qualifiedTable.slice(0, dot + 1) : '';
    return `DROP INDEX IF EXISTS ${prefix}${indexName};`;
  },

  dropTriggerStatement(triggerName: string, qualifiedTable: string): string {
    return `DROP TRIGGER IF EXISTS ${triggerName} ON ${qualifiedTable};`;
  },

  dropForeignKeyStatement(tableName: string, fkName: string): string {
    // Redshift does not support DROP CONSTRAINT IF EXISTS — plain form only.
    return `ALTER TABLE ${tableName} DROP CONSTRAINT ${fkName};`;
  },

  ...types,
};
