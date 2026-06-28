import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';


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

  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[] {
    const constraint = pkName ?? `PK_${tableName.replace(/^.*\./, '')}`;
    return [`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraint};`];
  },
};
