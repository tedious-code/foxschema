import type { TableSchema } from '../interfaces';

/** Minimal column info available in both full schema and diff contexts. */
export interface ColumnSpec {
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
  identity?: boolean;
  identityGeneration?: string;
}

export interface SqlDialect {
  /** Clause appended after the column type for auto-increment/identity columns. Empty string = no clause. */
  identityClause(c: ColumnSpec): string;

  /** Full ALTER TABLE ... ADD [COLUMN] statement. */
  addColumnStatement(tableName: string, colDef: string): string;

  /** Full ALTER TABLE ... MODIFY / ALTER COLUMN statement(s). Returns one or more statements. */
  modifyColumnStatements(tableName: string, colName: string, col: ColumnSpec): string[];

  /** Full ALTER TABLE ... DROP [COLUMN] statement. */
  dropColumnStatement(tableName: string, colName: string): string;

  /** Statement(s) to drop an existing primary key before adding a new one. */
  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[];
}

/** Full schema column — a superset of ColumnSpec, so assignable to it. */
export type FullColumn = TableSchema['columns'][number];
