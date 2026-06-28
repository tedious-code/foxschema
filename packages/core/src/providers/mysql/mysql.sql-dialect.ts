import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';


const mysqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` AUTO_INCREMENT` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    return [`ALTER TABLE ${tableName} MODIFY COLUMN ${colName} ${col.type};`];
  },

  dropColumnStatement(tableName: string, colName: string): string {
    return `ALTER TABLE ${tableName} DROP ${colName};`;
  },

  dropPrimaryKeyStatements(tableName: string, _pkName: string | undefined): string[] {
    return [`ALTER TABLE ${tableName} DROP PRIMARY KEY;`];
  },
};

export const mysqlSqlDialect: SqlDialect = mysqlDialect;
export const mariadbSqlDialect: SqlDialect = mysqlDialect;
