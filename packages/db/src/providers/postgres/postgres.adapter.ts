import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '@foxschema/sql';
import { assertSafeIdentifier } from '../../cores/sql-identifier';
import { BoundedPoolCache, disposePoolEndOrClose } from '../../cores/pool-cache';
import { guardClientErrors, guardPoolErrors } from '../../cores/pool-error-guard';
import { connectTimeoutMs } from '../../cores/timeouts';

const nodeRequire = createRequire(import.meta.url);

/** node-postgres (pg) adapter — connection pooling via pg.Pool. */
class PostgresAdapter implements DriverAdapter {
  readonly dialect = 'postgres';
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
      throw new Error(`Database driver "${this.packageName}" is not installed for postgres. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  async acquire(connectionString: string, options: ConnectionOptions, _pooled: boolean): Promise<any> {
    const pool = await this.pools.getOrCreate(connectionString, () => {
      const pg = this.load();
      const pool = new pg.Pool({
        connectionString,
        max: options.pool?.max ?? 10,
        min: options.pool?.min ?? 1,
        idleTimeoutMillis: options.pool?.idleTimeoutMs ?? 30000,
        connectionTimeoutMillis: connectTimeoutMs(options, 10_000),
        ssl: options.ssl?.enabled
          ? {
              rejectUnauthorized: options.ssl.rejectUnauthorized ?? false,
              ca: options.ssl.ca,
              cert: options.ssl.cert,
              key: options.ssl.key,
            }
          : false,
      });
      return guardPoolErrors(pool, 'postgres');
    });
    // pg clients reset transaction state on release, so pooling is safe for migrations too
    // The pool's guard covers idle connections; a checked-out client emits
    // `'error'` on itself, and an unhandled one takes the process down.
    return guardClientErrors(await pool.connect(), 'postgres');
  }

  async release(connection: any): Promise<void> {
    if (connection) connection.release();
  }

  async query<T = Record<string, unknown>>(connection: any, sql: string, params: readonly unknown[]): Promise<T[]> {
    const result = await connection.query(sql, params as unknown[]);
    return result.rows as T[];
  }

  /**
   * `rowMode: 'array'` makes pg hand back arrays plus a field list, so a join
   * with two `id` columns keeps both. The default object mode cannot: the row
   * object has one `id` key and the earlier column is lost.
   */
  async queryPositional(connection: any, sql: string, params: readonly unknown[]) {
    const result = await connection.query({
      text: sql,
      values: params as unknown[],
      rowMode: 'array',
    });
    return {
      columns: (result.fields ?? []).map((f: { name: string }) => f.name),
      rows: (result.rows ?? []) as unknown[][],
    };
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
    await this.pools.clear();
  }
}

export const postgresAdapter = new PostgresAdapter();
