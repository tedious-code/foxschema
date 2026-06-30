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

  /**
   * Extract a backing sequence name from a column default expression
   * (e.g. `nextval('schema.seq'::regclass)` → `seq`). Return null if this
   * dialect doesn't need pre-created backing sequences for serial columns.
   * When non-null, the generator creates the sequence before the table/column.
   */
  serialSequenceFromDefault?(defaultValue: string): string | null;

  /**
   * Return a SQL block that saves and drops all views transitively dependent on
   * `qualifiedTable` so that column ALTER/DROP can proceed without "column used
   * by a view" errors. Called before column changes; pair with
   * `recreateDependentViewsBlock` using the same `qualifiedTable`.
   * Return null if the dialect doesn't need this guard.
   */
  dropDependentViewsBlock?(qualifiedTable: string): string | null;

  /**
   * Return a SQL block that recreates the views saved by `dropDependentViewsBlock`.
   * Must be called with the same `qualifiedTable`. Return null if not applicable.
   */
  recreateDependentViewsBlock?(qualifiedTable: string): string | null;

  /**
   * If defined, the dialect encodes nullability inside the type string rather than
   * via NULL / NOT NULL keywords (e.g. ClickHouse Nullable(T)). Called instead of
   * appending NULL/NOT NULL; returns the full column type string.
   */
  nullableTypeWrapper?(typeSql: string, nullable: boolean): string;

  /**
   * DROP INDEX statement for the dialect. MySQL needs `DROP INDEX name ON table;`
   * rather than the generic `DROP INDEX schema.name;`.
   */
  dropIndexStatement?(indexName: string, qualifiedTable: string): string;

  /**
   * DROP TRIGGER statement for the dialect. MySQL needs `DROP TRIGGER IF EXISTS name;`.
   */
  dropTriggerStatement?(triggerName: string, qualifiedTable: string): string;

  /**
   * Wrap a trigger body in a full CREATE TRIGGER statement for the dialect.
   * Return null to fall back to emitting `trigger.definition` verbatim (for dialects
   * where the stored definition is already the complete CREATE TRIGGER statement).
   */
  createTriggerStatement?(
    trigger: { name: string; timing?: string; event?: string; definition?: string },
    qualifiedTable: string
  ): string | null;

  /**
   * ALTER TABLE statement to drop a foreign key constraint.
   * Defaults to `ALTER TABLE t DROP CONSTRAINT IF EXISTS name;` (Postgres/SQLite/DB2).
   * MySQL overrides this with `ALTER TABLE t DROP FOREIGN KEY name;` because MySQL
   * uses a separate FK namespace and doesn't support DROP CONSTRAINT IF EXISTS.
   */
  dropForeignKeyStatement?(tableName: string, fkName: string): string;

  /**
   * Statement(s) to execute immediately before `DROP TABLE tableName`.
   * Use to drop inbound FK constraints that would otherwise block the drop
   * (SQL Server does not support DROP TABLE CASCADE).
   * Return an empty array (or omit) if no pre-drop cleanup is needed.
   */
  preDropTableStatements?(tableName: string): string[];

  /**
   * Full CREATE VIEW statement for an added view.
   * Default: `CREATE OR REPLACE VIEW name AS body` (Postgres / MySQL / MariaDB style).
   * SQL Server overrides with `CREATE VIEW name AS body`.
   */
  createViewStatement?(name: string, body: string): string;

  /**
   * Full statement to replace an existing view's definition.
   * Default: `CREATE OR REPLACE VIEW name AS body`.
   * SQL Server overrides with `ALTER VIEW name AS body`.
   */
  alterViewStatement?(name: string, body: string): string;

  /**
   * Wrap the standard `CREATE SEQUENCE IF NOT EXISTS name ...` into a dialect-safe form.
   * Called with the qualified name and the full `CREATE SEQUENCE name ...;` string.
   * SQL Server has no `IF NOT EXISTS` for sequences — it uses an OBJECT_ID guard instead.
   * Default: returns `CREATE SEQUENCE IF NOT EXISTS name ...;`.
   */
  wrapCreateSequence?(qualifiedName: string, createSql: string): string;

  // ── Version-aware DROP hooks ────────────────────────────────────────────────
  // Each hook receives the server version string detected at connect time.
  // When the version is undefined the hook should fall back to the modern syntax.
  // Default (no hook): generator emits `DROP <OBJECT> IF EXISTS name;`.
  // Oracle pre-23c and old DB2 cannot use IF EXISTS — they override with a
  // PL/SQL / SQL-PL anonymous block that swallows the "does not exist" error.

  /** Version-safe DROP TABLE statement. */
  dropTableStatement?(name: string, version?: string): string;
  /** Version-safe DROP VIEW statement. */
  dropViewStatement?(name: string, version?: string): string;
  /** Version-safe DROP SEQUENCE statement. */
  dropSequenceStatement?(name: string, version?: string): string;
  /** Version-safe DROP FUNCTION statement (no parameter signature — use for dialects where name alone identifies the routine). */
  dropFunctionStatement?(name: string, version?: string): string;
  /** Version-safe DROP PROCEDURE statement. */
  dropProcedureStatement?(name: string, version?: string): string;
}

/** Full schema column — a superset of ColumnSpec, so assignable to it. */
export type FullColumn = TableSchema['columns'][number];
