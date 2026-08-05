import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import { makeDialectTypeFns, plain, sized, decimalAs } from '../../modules/type-mapping';

// ClickHouse type names are case-sensitive. Lowercase the token for parseMap lookup.
const types = makeDialectTypeFns({
  label: 'ClickHouse',
  parseMap: {
    // Signed integers
    int8: 'smallint', int16: 'smallint',
    int32: 'integer', int64: 'bigint', int128: 'bigint', int256: 'bigint',
    // Unsigned integers (promote to next signed size to avoid overflow)
    uint8: 'smallint', uint16: 'integer',
    uint32: 'bigint', uint64: 'bigint', uint128: 'bigint', uint256: 'bigint',
    // Float
    float32: 'real', float64: 'double',
    // String
    string: 'text',
    fixedstring: 'char',
    // Boolean
    bool: 'boolean', boolean: 'boolean',
    // Date/time
    date: 'date', date32: 'date',
    datetime: 'timestamp', datetime64: 'timestamp',
    // Decimal
    decimal: 'decimal', decimal32: 'decimal', decimal64: 'decimal',
    decimal128: 'decimal', decimal256: 'decimal',
    // UUID
    uuid: 'uuid',
    // Semi-structured
    json: 'json',
    // Enums → text (values are label strings)
    enum8: 'text', enum16: 'text',
  },
  renderMap: {
    boolean: plain('Bool'),
    smallint: plain('Int16'),
    integer: plain('Int32'),
    bigint: plain('Int64'),
    decimal: decimalAs('Decimal'),
    real: plain('Float32'),
    double: plain('Float64'),
    char: sized('FixedString'),
    varchar: plain('String'),
    text: plain('String'),
    binary: plain('String'),
    varbinary: plain('String'),
    blob: plain('String'),
    date: plain('Date'),
    time: plain('String'),
    timestamp: plain('DateTime64(3)'),
    timestamptz: plain("DateTime64(3, 'UTC')"),
    uuid: plain('UUID'),
    json: plain('JSON'),
    xml: plain('String'),
  },
});

export const clickHouseSqlDialect: SqlDialect = {
  // ClickHouse has no auto-increment / identity concept
  identityClause(_c: ColumnSpec): string {
    return '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [`ALTER TABLE ${tableName} MODIFY COLUMN ${colName} ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[] {
    if (defaultValue) {
      return [`ALTER TABLE ${tableName} MODIFY COLUMN ${colName} DEFAULT ${defaultValue};`];
    }
    return [`ALTER TABLE ${tableName} MODIFY COLUMN ${colName} REMOVE DEFAULT;`];
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    // ClickHouse PRIMARY KEY is embedded in the ENGINE clause — it cannot be dropped separately.
    return [`-- review: ${tableName}: ClickHouse PRIMARY KEY is part of the ENGINE clause and cannot be altered in place. Recreate the table to change the key.`];
  },

  // ClickHouse uses Nullable(T) wrapper instead of NULL / NOT NULL keywords.
  nullableTypeWrapper(typeSql: string, nullable: boolean): string {
    return nullable ? `Nullable(${typeSql})` : typeSql;
  },

  ...types,
};
