import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '@foxschema/shared';
import { assertSafeIdentifier } from '../../cores/sql-identifier';

const nodeRequire = createRequire(import.meta.url);

/** node-postgres (pg) adapter — connection pooling via pg.Pool. */
class PostgresAdapter implements DriverAdapter {
  readonly dialect = 'postgres';
  readonly packageName = 'pg';

  private pools = new Map<string, any>();
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    try {
      const mod = nodeRequire(this.packageName);
      this.driver = mod.default ?? mod;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for postgres. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  async acquire(connectionString: string, options: ConnectionOptions, _pooled: boolean): Promise<any> {
    let pool = this.pools.get(connectionString);
    if (!pool) {
      const pg = this.load();
      pool = new pg.Pool({
        connectionString,
        max: options.pool?.max ?? 10,
        min: options.pool?.min ?? 1,
        idleTimeoutMillis: options.pool?.idleTimeoutMs ?? 30000,
        connectionTimeoutMillis: options.timeout?.connectMs ?? 10000,
        ssl: options.ssl?.enabled
          ? {
              rejectUnauthorized: options.ssl.rejectUnauthorized ?? false,
              ca: options.ssl.ca,
              cert: options.ssl.cert,
              key: options.ssl.key,
            }
          : false,
      });
      this.pools.set(connectionString, pool);
    }
    // pg clients reset transaction state on release, so pooling is safe for migrations too
    return pool.connect();
  }

  async release(connection: any): Promise<void> {
    if (connection) connection.release();
  }

  async query<T = Record<string, unknown>>(connection: any, sql: string, params: readonly unknown[]): Promise<T[]> {
    const result = await connection.query(sql, params as unknown[]);
    return result.rows as T[];
  }

  async beginTransaction(connection: any): Promise<void> {
    await this.query(connection, 'BEGIN', []);
  }

  async commitTransaction(connection: any): Promise<void> {
    await this.query(connection, 'COMMIT', []);
  }

  async rollbackTransaction(connection: any): Promise<void> {
    await this.query(connection, 'ROLLBACK', []);
  }

  async setCurrentSchema(connection: any, schema: string): Promise<void> {
    // Interpolated into SQL (can't be parameterized) — must be a safe identifier
    await this.query(connection, `SET search_path TO ${assertSafeIdentifier(schema, 'schema')}`, []);
  }

  async closeAll(): Promise<void> {
    const pools = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.all(pools.map((p) => (typeof p.end === 'function' ? p.end() : Promise.resolve())));
  }
}

export const postgresAdapter = new PostgresAdapter();
