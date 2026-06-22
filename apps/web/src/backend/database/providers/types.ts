/**
 * Metadata-store provider contract. The app's own database (users, connections,
 * preferences, sessions, history, settings) is reached only through this small
 * async interface, so the engine is pluggable: SQLite (bundled default),
 * Postgres, MySQL, or a user-supplied provider registered at runtime.
 *
 * All queries use `?` positional placeholders and standard double-quoted
 * identifiers (`"schema"`, `"key"`, `"value"`); each provider rewrites those to
 * its own dialect. Values bound as `?` are never interpolated.
 */

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export type SqlParam = string | number | null;

export interface RunResult {
  /** Rows affected by an INSERT/UPDATE/DELETE. */
  changes: number;
}

export interface MetadataStore {
  readonly dialect: Dialect;
  /** Connect + verify reachability. Migrations are run separately by the store. */
  init(): Promise<void>;
  all<T = unknown>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = unknown>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  /** Run DDL / a parameterless statement. */
  exec(sql: string): Promise<void>;
  /** Portable INSERT … or update `updateColumns` on a `conflictColumns` clash. */
  upsert(
    table: string,
    conflictColumns: string[],
    row: Record<string, SqlParam>,
    updateColumns: string[]
  ): Promise<void>;
  close(): Promise<void>;
}
