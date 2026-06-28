import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';


export const db2SqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET DATA TYPE ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    return [`ALTER TABLE ${tableName} DROP PRIMARY KEY;`];
  },
};
