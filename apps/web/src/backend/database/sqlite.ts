import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrations';

// Default lives in src/backend/database/, anchored to this module so it's
// independent of the process working directory. Override with APP_DB_PATH
// (resolved relative to cwd) in production/deploys.
const DEFAULT_DB_PATH = fileURLToPath(new URL('./foxschema.db', import.meta.url));

let db: DatabaseSync | null = null;

/**
 * App metadata store (users, connections, preferences, sessions). This is the
 * application's own database — separate from the user databases being compared,
 * which go through the provider/adapter layer.
 */
export function getDb(): DatabaseSync {
  if (db) return db;
  const path = process.env.APP_DB_PATH || DEFAULT_DB_PATH;
  db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
