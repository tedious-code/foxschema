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

// Oracle 23c introduced DROP IF EXISTS. Pre-23c requires PL/SQL exception blocks.
function oracleMajor(version?: string): number {
  if (!version) return 0;
  return parseInt(version.split('.')[0], 10) || 0;
}

function oracleDrop(keyword: string, name: string, sqlcode: number, version?: string): string {
  if (oracleMajor(version) >= 23) return `DROP ${keyword} IF EXISTS ${name};`;
  const safe = name.replace(/'/g, "''");
  return `BEGIN\n  EXECUTE IMMEDIATE 'DROP ${keyword} ${safe}';\nEXCEPTION\n  WHEN OTHERS THEN IF SQLCODE != ${sqlcode} THEN RAISE; END IF;\nEND;\n/`;
}

export const oracleSqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    const nullClause = col.nullable ? ' NULL' : ' NOT NULL';
    return [`ALTER TABLE ${tableName} MODIFY ${colName} ${col.type}${nullClause};`];
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

  dropForeignKeyStatement(tableName: string, fkName: string): string {
    // Oracle has no DROP CONSTRAINT IF EXISTS — emit the plain form (the migration
    // drops constraints it knows exist; a missing one is a genuine error to surface).
    return `ALTER TABLE ${tableName} DROP CONSTRAINT ${fkName};`;
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

  createTriggerStatement(
    trg: { name: string; timing?: string; event?: string; definition?: string },
    qualifiedTable: string
  ): string | null {
    if (!trg.definition) return null;
    // Oracle ALL_TRIGGERS.TRIGGER_TYPE = 'BEFORE EACH ROW' / 'AFTER EACH ROW' / 'INSTEAD OF' etc.
    // ALL_TRIGGERS.TRIGGERING_EVENT = 'INSERT' / 'UPDATE' / 'INSERT OR UPDATE' etc.
    const rawType = (trg.timing ?? 'AFTER EACH ROW').toUpperCase();
    const event = (trg.event ?? 'INSERT').toUpperCase();
    const isInstead = rawType.startsWith('INSTEAD');
    const timing = isInstead ? 'INSTEAD OF' : rawType.startsWith('BEFORE') ? 'BEFORE' : 'AFTER';
    const forEachRow = rawType.includes('EACH ROW') && !isInstead ? '\nFOR EACH ROW' : '';
    return `CREATE OR REPLACE TRIGGER ${trg.name}\n${timing} ${event} ON ${qualifiedTable}${forEachRow}\n${trg.definition.trim()};`;
  },

  // ORA-00942 = table or view does not exist
  dropTableStatement(name: string, version?: string): string {
    return oracleDrop('TABLE', name, -942, version);
  },

  // ORA-00942 = view does not exist (same code)
  dropViewStatement(name: string, version?: string): string {
    return oracleDrop('VIEW', name, -942, version);
  },

  // ORA-02289 = sequence does not exist
  dropSequenceStatement(name: string, version?: string): string {
    return oracleDrop('SEQUENCE', name, -2289, version);
  },

  // ORA-04043 = object does not exist
  dropFunctionStatement(name: string, version?: string): string {
    return oracleDrop('FUNCTION', name, -4043, version);
  },

  dropProcedureStatement(name: string, version?: string): string {
    return oracleDrop('PROCEDURE', name, -4043, version);
  },

  ...types,
};
