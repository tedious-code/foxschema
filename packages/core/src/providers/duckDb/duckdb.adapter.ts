import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';

const nodeRequire = createRequire(import.meta.url);

interface DuckHandle {
  instance: any;
  conn: any;
}

/**
 * DuckDB adapter via @duckdb/node-api (async). DuckDB is embedded like SQLite —
 * the "connection string" is a file path (or ':memory:'). One instance +
 * connection is cached per path; different files (e.g. a source and target DB)
 * get independent handles.
 *
 * getRowObjects() returns BIGINT columns as JS bigint; introspection code
 * expects plain numbers/strings, so query() coerces bigint to Number.
 */
class DuckDbAdapter implements DriverAdapter {
  readonly dialect = 'duckdb';
  readonly packageName = '@duckdb/node-api';

  private handles = new Map<string, Promise<DuckHandle>>();
  private api: any;

  private load(): any {
    if (this.api) return this.api;
    try {
      this.api = nodeRequire(this.packageName);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for duckdb. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.api;
  }

  async acquire(connectionString: string, _options: ConnectionOptions, _pooled: boolean): Promise<DuckHandle> {
    let pending = this.handles.get(connectionString);
    if (!pending) {
      const { DuckDBInstance } = this.load();
      pending = (async () => {
        const instance = await DuckDBInstance.create(connectionString);
        const conn = await instance.connect();
        return { instance, conn };
      })();
      this.handles.set(connectionString, pending);
    }
    return pending;
  }

  async release(_handle: DuckHandle): Promise<void> {
    // Cached; closed in closeAll().
  }

  async query<T = Record<string, unknown>>(handle: DuckHandle, sql: string, params: readonly unknown[]): Promise<T[]> {
    const reader = params.length
      ? await handle.conn.runAndReadAll(sql, params as unknown[])
      : await handle.conn.runAndReadAll(sql);
    return reader.getRowObjects().map(coerceBigints) as T[];
  }

  async beginTransaction(handle: DuckHandle): Promise<void> {
    await handle.conn.run('BEGIN TRANSACTION');
  }

  async commitTransaction(handle: DuckHandle): Promise<void> {
    await handle.conn.run('COMMIT');
  }

  async rollbackTransaction(handle: DuckHandle): Promise<void> {
    try { await handle.conn.run('ROLLBACK'); } catch { /* ignore */ }
  }

  async setCurrentSchema(handle: DuckHandle, schema: string): Promise<void> {
    // DuckDB is schema-aware; SET schema scopes unqualified names.
    if (schema) await handle.conn.run(`SET schema='${schema.replace(/'/g, "''")}'`);
  }

  async closeAll(): Promise<void> {
    const pending = Array.from(this.handles.values());
    this.handles.clear();
    await Promise.all(
      pending.map(async (p) => {
        try {
          const h = await p;
          h.conn?.closeSync?.();
          h.instance?.closeSync?.();
        } catch { /* ignore */ }
      })
    );
  }
}

/** Shallow-coerce bigint values in a row object to Number (introspection values are small). */
function coerceBigints(row: Record<string, unknown>): Record<string, unknown> {
  let hasBig = false;
  for (const k in row) if (typeof row[k] === 'bigint') { hasBig = true; break; }
  if (!hasBig) return row;
  const out: Record<string, unknown> = {};
  for (const k in row) out[k] = typeof row[k] === 'bigint' ? Number(row[k] as bigint) : row[k];
  return out;
}

export const duckDbAdapter = new DuckDbAdapter();
