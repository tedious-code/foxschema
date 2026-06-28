import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';
import { assertSafeIdentifier } from '../../cores/sql-identifier';
import { setupDb2ClientEnv } from './db2.env';

const nodeRequire = createRequire(import.meta.url);

/**
 * ibm_db adapter. Pooled via the driver's built-in Pool so each schema load
 * reuses connections instead of paying the (expensive) DB2 connect cost per op.
 */
class Db2Adapter implements DriverAdapter {
  readonly dialect = 'db2';
  readonly packageName = 'ibm_db';

  private pools = new Map<string, any>();
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    setupDb2ClientEnv(); // point at the bundled clidriver before native load
    try {
      const mod = nodeRequire(this.packageName);
      this.driver = mod.default ?? mod;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for db2. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  async acquire(connectionString: string, options: ConnectionOptions, pooled: boolean): Promise<any> {
    const ibmdb = this.load();

    // Transactional callers (migrations) want a dedicated connection so a
    // mid-transaction connection is never returned to the shared pool.
    // Older ibm_db builds may also lack Pool — fall back to a raw open.
    if (!pooled || !ibmdb.Pool) {
      return new Promise((resolve, reject) =>
        ibmdb.open(connectionString, (err: Error | null, conn: any) => (err ? reject(err) : resolve(conn)))
      );
    }

    let pool = this.pools.get(connectionString);
    if (!pool) {
      pool = new ibmdb.Pool();
      if (typeof pool.setMaxPoolSize === 'function') pool.setMaxPoolSize(options.pool?.max ?? 10);
      if (typeof pool.setConnectTimeout === 'function' && options.timeout?.connectMs) {
        pool.setConnectTimeout(Math.ceil(options.timeout.connectMs / 1000));
      }
      if (typeof pool.setIdleTimeout === 'function' && options.pool?.idleTimeoutMs) {
        pool.setIdleTimeout(Math.ceil(options.pool.idleTimeoutMs / 1000));
      }
      this.pools.set(connectionString, pool);
    }

    return new Promise((resolve, reject) =>
      pool.open(connectionString, (err: Error | null, conn: any) => (err ? reject(err) : resolve(conn)))
    );
  }

  async release(connection: any): Promise<void> {
    if (!connection) return;
    // A pooled connection's close() returns it to the pool; a raw one closes.
    await new Promise<void>((resolve, reject) =>
      connection.close((err: Error | null) => (err ? reject(err) : resolve()))
    );
  }

  query<T = Record<string, unknown>>(connection: any, sql: string, params: readonly unknown[]): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) =>
      connection.query(sql, [...params], (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows ?? [])))
    );
  }

  beginTransaction(connection: any): Promise<void> {
    return new Promise((resolve, reject) =>
      connection.beginTransaction((err: Error | null) => (err ? reject(err) : resolve()))
    );
  }

  commitTransaction(connection: any): Promise<void> {
    return new Promise((resolve, reject) =>
      connection.commitTransaction((err: Error | null) => (err ? reject(err) : resolve()))
    );
  }

  rollbackTransaction(connection: any): Promise<void> {
    return new Promise((resolve, reject) =>
      connection.rollbackTransaction((err: Error | null) => (err ? reject(err) : resolve()))
    );
  }

  async setCurrentSchema(connection: any, schema: string): Promise<void> {
    // Interpolated into SQL (can't be parameterized) — must be a safe identifier
    const s = assertSafeIdentifier(schema, 'schema').toUpperCase();
    await this.query(connection, `SET CURRENT SCHEMA = ${s}`, []);
    // Unqualified function/procedure resolution follows CURRENT PATH, not CURRENT SCHEMA
    await this.query(connection, `SET CURRENT PATH = SYSTEM PATH, ${s}`, []);
  }

  async closeAll(): Promise<void> {
    const pools = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.all(
      pools.map((p) =>
        typeof p.close === 'function' ? new Promise<void>((resolve) => p.close(() => resolve())) : Promise.resolve()
      )
    );
  }
}

export const db2Adapter = new Db2Adapter();
