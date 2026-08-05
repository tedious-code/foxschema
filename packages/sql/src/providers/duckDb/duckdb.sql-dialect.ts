import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import type { TableSchema } from '../../interfaces';
import { makeDialectTypeFns, plain, sized, decimalAs } from '../../modules/type-mapping';

// DuckDB's type system is Postgres-flavored. Key differences from Postgres:
// binary is BLOB (not bytea), and it exposes HUGEINT / unsigned ints (mapped
// down to the nearest canonical type here).
const types = makeDialectTypeFns({
  label: 'DuckDB',
  parseMap: {
    boolean: 'boolean',
    bool: 'boolean',
    tinyint: 'smallint',
    smallint: 'smallint',
    int2: 'smallint',
    integer: 'integer',
    int: 'integer',
    int4: 'integer',
    bigint: 'bigint',
    int8: 'bigint',
    hugeint: 'bigint',
    numeric: 'decimal',
    decimal: 'decimal',
    real: 'real',
    float4: 'real',
    float: 'real',
    'double precision': 'double',
    double: 'double',
    float8: 'double',
    char: 'char',
    bpchar: 'char',
    'character varying': 'varchar',
    varchar: 'varchar',
    text: 'text',
    string: 'text',
    blob: 'blob',
    bytea: 'blob',
    date: 'date',
    time: 'time',
    timestamp: 'timestamp',
    'timestamp without time zone': 'timestamp',
    'timestamp with time zone': 'timestamptz',
    timestamptz: 'timestamptz',
    uuid: 'uuid',
    json: 'json',
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
    varchar: sized('VARCHAR'),
    text: plain('VARCHAR'),
    binary: plain('BLOB'),
    varbinary: plain('BLOB'),
    blob: plain('BLOB'),
    date: plain('DATE'),
    time: plain('TIME'),
    timestamp: plain('TIMESTAMP'),
    timestamptz: plain('TIMESTAMP WITH TIME ZONE'),
    uuid: plain('UUID'),
    json: plain('JSON'),
    xml: plain('VARCHAR'),
  },
});

export const duckDbSqlDialect: SqlDialect = {
  // DuckDB has no GENERATED ... AS IDENTITY; auto-increment is done with a
  // sequence + DEFAULT nextval, so no inline identity clause is emitted.
  identityClause(_c: ColumnSpec): string {
    return '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`;
  },

  // DuckDB: ALTER COLUMN TYPE, plus separate SET/DROP NOT NULL and SET/DROP
  // DEFAULT — like Postgres but without the USING cast (DuckDB casts implicitly)
  // and without the procedural view-dependency guard.
  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    const stmts = [
      `ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP DEFAULT;`,
      `ALTER TABLE ${tableName} ALTER COLUMN ${colName} TYPE ${col.type};`,
    ];
    stmts.push(
      col.nullable
        ? `ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP NOT NULL;`
        : `ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET NOT NULL;`
    );
    if (col.defaultValue) {
      stmts.push(`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DEFAULT ${col.defaultValue};`);
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

  // DuckDB DEFAULT nextval('seq') references a backing sequence — create it first.
  serialSequenceFromDefault(defaultValue: string): string | null {
    if (!defaultValue) return null;
    const m = defaultValue.match(/nextval\(\s*'([^']+)'\s*\)/i);
    if (!m) return null;
    return m[1].replace(/"/g, '').replace(/^[^.]+\./, '');
  },

  dropIndexStatement(indexName: string, qualifiedTable: string): string {
    const dot = qualifiedTable.indexOf('.');
    const prefix = dot >= 0 ? qualifiedTable.slice(0, dot + 1) : '';
    return `DROP INDEX IF EXISTS ${prefix}${indexName};`;
  },

  // DuckDB has no triggers — this hook shouldn't be reached, but keep it valid.
  dropTriggerStatement(triggerName: string, _qualifiedTable: string): string {
    return `DROP TRIGGER IF EXISTS ${triggerName};`;
  },

  createTypeStatement(schema: TableSchema): string | null {
    const u = schema.userType ?? {};
    if (u.metaType === 'E' && u.attributes && u.attributes.length > 0) {
      const vals = u.attributes.map((a) => `'${a.name.replace(/'/g, "''")}'`).join(', ');
      return `CREATE TYPE ${schema.name} AS ENUM (${vals});`;
    }
    return null;
  },

  ...types,
};
