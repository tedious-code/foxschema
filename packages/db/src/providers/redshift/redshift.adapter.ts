import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '@foxschema/sql';
import { assertSafeIdentifier } from '../../cores/sql-identifier';
import { BoundedPoolCache, disposePoolEndOrClose } from '../../cores/pool-cache';
import { guardPoolErrors } from '../../cores/pool-error-guard';

const nodeRequire = createRequire(import.meta.url);

class RedshiftAdapter implements DriverAdapter {
  readonly dialect = 'redshift';
  readonly packageName = 'pg';

  private pools = new BoundedPoolCache<any>(disposePoolEndOrClose);
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    try {
      const mod = nodeRequire(this.packageName);
      this.driver = mod.default ?? mod;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for redshift. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  async acquire(connectionString: string, options: ConnectionOptions, _pooled: boolean): Promise<any> {
    const pool = await this.pools.getOrCreate(connectionString, () => {
      const pg = this.load();
      const pool = new pg.Pool({
        connectionString,
        max: options.pool?.max ?? 5,
        min: options.pool?.min ?? 1,
        idleTimeoutMillis: options.pool?.idleTimeoutMs ?? 30000,
        connectionTimeoutMillis: options.timeout?.connectMs ?? 10000,
        ssl: options.ssl?.enabled
          ? { rejectUnauthorized: options.ssl.rejectUnauthorized ?? false }
          : false,
      });
      return guardPoolErrors(pool, 'redshift');
    });
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
    await this.query(connection, `SET search_path TO ${assertSafeIdentifier(schema, 'schema')}`, []);
  }

  async closeAll(): Promise<void> {
    await this.pools.clear();
  }
}

export const redshiftAdapter = new RedshiftAdapter();
