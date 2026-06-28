import type { SqlDialect, ColumnSpec } from '../../modules/sql-dialect.interface';


export const postgresSqlDialect: SqlDialect = {
  identityClause(c: ColumnSpec): string {
    return c.identity ? ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY` : '';
  },

  addColumnStatement(tableName: string, colDef: string): string {
    return `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`;
  },

  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[] {
    const stmts = [`ALTER TABLE ${tableName} ALTER COLUMN ${colName} TYPE ${col.type};`];
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

  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[] {
    const constraint = pkName ?? `${tableName.replace(/^.*\./, '')}_pkey`;
    return [`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraint};`];
  },
};
