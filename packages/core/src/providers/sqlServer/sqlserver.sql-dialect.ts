import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';
import type { IndexInfo, TableSchema } from '../../interfaces';
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
    const nullClause = col.nullable ? ' NULL' : ' NOT NULL';
    const identity = col.identity ? ' IDENTITY(1,1)' : '';
    const collateClause = col.collation ? ` COLLATE ${col.collation}` : '';
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} ${col.type}${collateClause}${identity}${nullClause};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[] {
    // SQL Server defaults are system-named constraints (DF__…), so drop the existing one
    // by looking its name up dynamically (same pattern preDropTableStatements uses for
    // FKs), then add the new default. Emitted as one T-SQL batch — the executor runs each
    // statement as its own batch, so DECLARE/EXEC/ALTER together is fine.
    const dropExisting =
      `DECLARE @df sysname; ` +
      `SELECT @df = dc.name FROM sys.default_constraints dc ` +
      `JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id ` +
      `WHERE dc.parent_object_id = OBJECT_ID('${tableName}') AND c.name = '${colName}'; ` +
      `IF @df IS NOT NULL EXEC('ALTER TABLE ${tableName} DROP CONSTRAINT [' + @df + ']');`;
    if (defaultValue === undefined) return [dropExisting];
    return [`${dropExisting} ALTER TABLE ${tableName} ADD DEFAULT ${defaultValue} FOR ${colName};`];
  },

  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[] {
    const constraint = pkName ?? `PK_${tableName.replace(/^.*\./, '')}`;
    return [`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraint};`];
  },

  dropIndexStatement(indexName: string, qualifiedTable: string, index?: IndexInfo): string {
    // A unique-constraint-backing index cannot be dropped with DROP INDEX ("An explicit
    // DROP INDEX is not allowed on index ... used for UNIQUE KEY constraint enforcement").
    // It must be dropped as the constraint it enforces.
    if (index?.constraint) return `ALTER TABLE ${qualifiedTable} DROP CONSTRAINT ${indexName};`;
    return `DROP INDEX ${indexName} ON ${qualifiedTable};`;
  },

  createIndexStatement(index: IndexInfo, qualifiedTable: string): string {
    // Recreate a unique constraint as a constraint (so it round-trips as one), not as a
    // plain unique index — the mirror of dropIndexStatement above.
    if (index.constraint) {
      return `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${index.name} UNIQUE (${index.columns.join(', ')});`;
    }
    const uniqueStr = index.unique ? ' UNIQUE' : '';
    return `CREATE${uniqueStr} INDEX ${index.name} ON ${qualifiedTable} (${index.columns.join(', ')});`;
  },

  dropTriggerStatement(triggerName: string, qualifiedTable: string): string {
    const dot = qualifiedTable.indexOf('.');
    const prefix = dot >= 0 ? qualifiedTable.slice(0, dot + 1) : '';
    return `DROP TRIGGER IF EXISTS ${prefix}${triggerName};`;
  },

  dropForeignKeyStatement(tableName: string, fkName: string): string {
    return `ALTER TABLE ${tableName} DROP CONSTRAINT ${fkName};`;
  },

  createViewStatement(name: string, body: string): string {
    return `CREATE VIEW ${name} AS\n${body}`;
  },

  alterViewStatement(name: string, body: string): string {
    return `ALTER VIEW ${name} AS\n${body}`;
  },

  // SQL Server's user-defined types are alias types (CREATE TYPE name FROM base_type),
  // not DB2's "AS (...) MODE DB2SQL" attribute-list syntax — the generic renderer's
  // fallback is invalid T-SQL. metaType 'D' is set by the provider for every row it
  // reads (sqlserver.provider.ts has no other kind). SQL Server has no ALTER TYPE —
  // a changed type must be dropped and recreated, which the generator's DROP+CREATE
  // path for MODIFIED objects already does by calling this same renderer.
  createTypeStatement(schema: TableSchema): string | null {
    const u = schema.userType ?? {};
    if (!u.sourceType) return null; // fall through to the generic renderer
    return `CREATE TYPE ${schema.name} FROM ${u.sourceType};`;
  },

  // SQL Server has no CREATE SEQUENCE IF NOT EXISTS — use an OBJECT_ID existence check.
  wrapCreateSequence(qualifiedName: string, createSql: string): string {
    const escaped = qualifiedName.replace(/'/g, "''");
    return `IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'${escaped}'))\n  ${createSql}`;
  },

  // SQL Server has no DROP TABLE CASCADE — drop all inbound FK constraints first
  // using a dynamic batch so the DROP TABLE can succeed even when other tables
  // (not in the current migration plan) still reference this one.
  preDropTableStatements(tableName: string): string[] {
    const escaped = tableName.replace(/'/g, "''");
    return [
      `DECLARE @s NVARCHAR(MAX)=N'';` +
      `SELECT @s+=N'ALTER TABLE '+QUOTENAME(SCHEMA_NAME(fk.schema_id))+N'.'+QUOTENAME(OBJECT_NAME(fk.parent_object_id))+N' DROP CONSTRAINT '+QUOTENAME(fk.name)+N';'` +
      ` FROM sys.foreign_keys fk WHERE fk.referenced_object_id=OBJECT_ID(N'${escaped}');` +
      `IF @s<>N'' EXEC sp_executesql @s`,
    ];
  },

  ...types,
};
