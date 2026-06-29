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

/**
 * Dialect-neutral type categories. Every provider parses its native types into
 * one of these and renders them back into its own syntax, so a type can travel
 * from one dialect to another (DB2 VARCHAR(255) → Postgres varchar(255)).
 */
export type CanonicalBase =
  | 'boolean'
  | 'smallint'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'real'
  | 'double'
  | 'char'
  | 'varchar'
  | 'text'
  | 'binary'
  | 'varbinary'
  | 'blob'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'timestamptz'
  | 'uuid'
  | 'json'
  | 'xml'
  | 'unknown';

/** A native column type normalized into the canonical model. */
export interface CanonicalType {
  base: CanonicalBase;
  length?: number; // char / varchar / binary
  precision?: number; // decimal
  scale?: number; // decimal
  /** Original native type string — used as fallback and in review comments. */
  raw: string;
}

/** Result of rendering a canonical type into a dialect's native syntax. */
export interface RenderedType {
  sql: string;
  /** Set when the mapping was inexact (e.g. no direct target equivalent). */
  warning?: string;
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

  /**
   * Statement(s) to change a column's DEFAULT. `defaultValue` undefined/empty
   * means drop the default. Dialects that can't express this in place return a
   * `-- review:` comment instead of invalid SQL.
   */
  setDefaultStatements(tableName: string, colName: string, defaultValue: string | undefined): string[];

  /** Statement(s) to drop an existing primary key before adding a new one. */
  dropPrimaryKeyStatements(tableName: string, pkName: string | undefined): string[];

  /** Parse a native type string (e.g. "VARCHAR(255)") into the canonical model. */
  parseType(raw: string): CanonicalType;

  /** Render a canonical type into this dialect's native syntax. */
  renderType(t: CanonicalType): RenderedType;
}

/** Full schema column — a superset of ColumnSpec, so assignable to it. */
export type FullColumn = TableSchema['columns'][number];
