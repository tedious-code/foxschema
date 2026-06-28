import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';


export const sqliteSqlDialect: SqlDialect = {
  identityClause(_c: ColumnSpec): string {
    // INTEGER PRIMARY KEY is implicitly autoincrement in SQLite — no extra keyword
    return '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    // SQLite ALTER COLUMN is only supported since 3.35.0 and limited
    return [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    // SQLite has no ALTER TABLE DROP PRIMARY KEY; must recreate the table
    return [`-- SQLite: recreate ${tableName} to change primary key`];
  },
};
