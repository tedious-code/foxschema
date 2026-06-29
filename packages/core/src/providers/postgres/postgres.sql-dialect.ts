import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, decimalAs } from '../../modules/type-mapping';

const types = makeDialectTypeFns({
  label: 'PostgreSQL',
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
    float8: 'double',
    character: 'char',
    char: 'char',
    bpchar: 'char',
    'character varying': 'varchar',
    varchar: 'varchar',
    text: 'text',
    bytea: 'blob',
    date: 'date',
    time: 'time',
    'time without time zone': 'time',
    'time with time zone': 'time',
    timestamp: 'timestamp',
    'timestamp without time zone': 'timestamp',
    'timestamp with time zone': 'timestamptz',
    timestamptz: 'timestamptz',
    uuid: 'uuid',
    json: 'json',
    jsonb: 'json',
    xml: 'xml',
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
    text: plain('text'),
    binary: plain('bytea'),
    varbinary: plain('bytea'),
    blob: plain('bytea'),
    date: plain('date'),
    time: plain('time'),
    timestamp: plain('timestamp'),
    timestamptz: plain('timestamptz'),
    uuid: plain('uuid'),
    json: plain('jsonb'),
    xml: plain('xml'),
  },
});

export const postgresSqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    // USING provides an explicit cast so Postgres doesn't rely on implicit coercion,
    // which may not exist for all type pairs (e.g. text → integer requires it).
    const stmts = [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} TYPE ${col.type} USING ${colName}::${col.type};`];
    if (col.nullable) {
      stmts.push(`ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP NOT NULL;`);
    } else {
      stmts.push(`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET NOT NULL;`);
    }
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

  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[] {
    const constraint = pkName ?? `${tableName.replace(/^.*\./, '')}_pkey`;
    return [`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraint};`];
  },

  ...types,
};
