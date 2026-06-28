import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';

const nodeRequire = createRequire(import.meta.url);

/**
 * MySQL / MariaDB adapter — connection pooling via mysql2's promise API.
 * MariaDB speaks the same wire protocol, so the same driver and adapter serve
 * both dialects (the dialect id differs only for settings/labels).
 */
class MysqlAdapter implements DriverAdapter {
  readonly dialect = 'mysql';
  readonly packageName = 'mysql2';

  private pools = new Map<string, any>();
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    try {
      // mysql2/promise exposes createPool returning promise-based connections
      const mod = nodeRequire('mysql2/promise');
      this.driver = mod.default ?? mod;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for mysql/mariadb. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  async acquire(connectionString: string, options: ConnectionOptions, pooled: boolean): Promise<any> {
    const mysql = this.load();

    const ssl = options.ssl?.enabled
      ? {
          rejectUnauthorized: options.ssl.rejectUnauthorized ?? false,
          ca: options.ssl.ca,
          cert: options.ssl.cert,
          key: options.ssl.key,
        }
      : undefined;

    // Dedicated connection for transactions (migrations) so BEGIN/COMMIT isn't
    // interleaved with other pooled work; pooled connections for reads.
    if (!pooled) {
      const conn = await mysql.createConnection({
        uri: connectionString,
        ssl,
        connectTimeout: options.timeout?.connectMs ?? 10000,
        multipleStatements: false,
      });
      // Tag so release() knows to fully close it instead of returning to a pool.
      conn.__dedicated = true;
      return conn;
    }

    let pool = this.pools.get(connectionString);
    if (!pool) {
      pool = mysql.createPool({
        uri: connectionString,
        ssl,
        connectionLimit: options.pool?.max ?? 10,
        connectTimeout: options.timeout?.connectMs ?? 10000,
        waitForConnections: true,
        multipleStatements: false,
      });
      this.pools.set(connectionString, pool);
    }
    return pool.getConnection();
  }

  async release(connection: any): Promise<void> {
    if (!connection) return;
    if (connection.__dedicated) {
      await connection.end();
    } else if (typeof connection.release === 'function') {
      connection.release();
    }
  }

  async query<T = Record<string, unknown>>(connection: any, sql: string, params: readonly unknown[]): Promise<T[]> {
    const [rows] = await connection.query(sql, params as unknown[]);
    return rows as T[];
  }

  async beginTransaction(connection: any): Promise<void> {
    await connection.beginTransaction();
  }

  async commitTransaction(connection: any): Promise<void> {
    await connection.commit();
  }

  async rollbackTransaction(connection: any): Promise<void> {
    await connection.rollback();
  }

  async setCurrentSchema(connection: any, schema: string): Promise<void> {
    // MySQL/MariaDB pin the active database with USE; identifier can't be a param.
    await connection.query(`USE \`${schema.replace(/`/g, '``')}\``);
  }

  async closeAll(): Promise<void> {
    const pools = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.all(pools.map((p) => (typeof p.end === 'function' ? p.end() : Promise.resolve())));
  }
}

export const mysqlAdapter = new MysqlAdapter();
