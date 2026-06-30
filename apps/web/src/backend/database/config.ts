/**
 * Metadata-store configuration — the seam for letting users run the app's own
 * database on something other than the bundled SQLite file.
 *
 * Phase 1 ships SQLite only (custom file location supported). The `engine`
 * field + this resolver are the extension point: a phase-2 Postgres/MySQL
 * adapter plugs in here without callers changing. The app metadata DB is
 * separate from the user databases being compared (those use the provider layer).
 */

import type { Dialect } from './stores/types';

export type DbEngine = Dialect;

export const SUPPORTED_ENGINES: DbEngine[] = ['sqlite', 'postgres', 'mysql'];

export interface MetadataDbConfig {
  engine: DbEngine;
  /** SQLite file path (engine === 'sqlite'). Undefined → module-relative default. */
  path?: string;
  /** Connection URL for server engines (postgres/mysql). */
  url?: string;
}

/**
 * Resolved from the environment the host sets:
 *   - APP_DB_ENGINE  (default 'sqlite')
 *   - APP_DB_PATH    (sqlite file location)
 *   - APP_DB_URL     (postgres/mysql connection string, phase 2)
 * On desktop these come from the one-time setup screen via the Tauri shell.
 */
export function getMetadataDbConfig(): MetadataDbConfig {
  const engine = (process.env.APP_DB_ENGINE || 'sqlite').toLowerCase() as DbEngine;
  return { engine, path: process.env.APP_DB_PATH, url: process.env.APP_DB_URL };
}
