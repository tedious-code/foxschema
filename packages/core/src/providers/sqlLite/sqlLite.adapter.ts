import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';

const nodeRequire = createRequire(import.meta.url);

/**
 * SQLite adapter via better-sqlite3 (synchronous API, wrapped in Promises).
 * The "connection" is the open Database object; the file path is the
 * connection string (use ':memory:' for in-memory databases).
 * SQLite has no real connection pools — we cache one db handle per path.
 */
class SqliteAdapter implements DriverAdapter {
  readonly dialect = 'sqlite';
  readonly packageName = 'better-sqlite3';

  private dbs = new Map<string, any>();
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    try {
      const mod = nodeRequire(this.packageName);
      this.driver = mod.default ?? mod;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for sqlite. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  async acquire(connectionString: string, _options: ConnectionOptions, _pooled: boolean): Promise<any> {
    const Database = this.load();
    let db = this.dbs.get(connectionString);
    if (!db) {
      db = new Database(connectionString, { readonly: true });
      this.dbs.set(connectionString, db);
    }
    return db;
  }

  async release(_db: any): Promise<void> {
    // Cached; closed in closeAll().
  }

  async query<T = Record<string, unknown>>(db: any, sql: string, params: readonly unknown[]): Promise<T[]> {
    const stmt = db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async beginTransaction(db: any): Promise<void> {
    db.prepare('BEGIN').run();
  }

  async commitTransaction(db: any): Promise<void> {
    db.prepare('COMMIT').run();
  }

  async rollbackTransaction(db: any): Promise<void> {
    try { db.prepare('ROLLBACK').run(); } catch { /* ignore */ }
  }

  async setCurrentSchema(_db: any, _schema: string): Promise<void> {
    // SQLite has no schema namespaces within a single file — no-op.
  }

  async closeAll(): Promise<void> {
    for (const db of this.dbs.values()) {
      try { db.close(); } catch { /* ignore */ }
    }
    this.dbs.clear();
  }
}

export const sqliteAdapter = new SqliteAdapter();
