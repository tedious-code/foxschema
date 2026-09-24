import { type ConnectionOptions, type DriverAdapter } from '@foxschema/sql';
import { BoundedPoolCache, disposePoolEndOrClose } from '../../cores/pool-cache.js';
import { guardPoolErrors } from '../../cores/pool-error-guard.js';
import { connectTimeoutMs } from '../../cores/timeouts.js';
import { requireDriver } from '../../cores/driver-loader.js';

/**
 * MySQL / MariaDB adapter — connection pooling via mysql2's promise API.
 * MariaDB speaks the same wire protocol, so the same driver and adapter serve
 * both dialects (the dialect id differs only for settings/labels).
 */
class MysqlAdapter implements DriverAdapter {
  readonly dialect = 'mysql';
  readonly packageName = 'mysql2';

  private pools = new BoundedPoolCache<any>(disposePoolEndOrClose);
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    // mysql2/promise exposes createPool returning promise-based connections
    this.driver = requireDriver(this.packageName, 'mysql/mariadb', { specifier: 'mysql2/promise' });
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
        connectTimeout: connectTimeoutMs(options, 10_000),
        multipleStatements: false,
      });
      // Tag so release() knows to fully close it instead of returning to a pool.
      conn.__dedicated = true;
      return conn;
    }

    const pool = await this.pools.getOrCreate(connectionString, () =>
      guardPoolErrors(
        mysql.createPool({
          uri: connectionString,
          ssl,
          connectionLimit: options.pool?.max ?? 10,
          connectTimeout: connectTimeoutMs(options, 10_000),
          waitForConnections: true,
          multipleStatements: false,
        }),
        'mysql'
      )
    );
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

  /**
   * `rowsAsArray` makes mysql2 return arrays plus field metadata, so a join
   * that selects `id` from two tables keeps both columns instead of collapsing
   * them onto one key of a row object.
   */
  async queryPositional(connection: any, sql: string, params: readonly unknown[]) {
    const [rows, fields] = await connection.query({
      sql,
      values: params as unknown[],
      rowsAsArray: true,
    });
    return {
      columns: ((fields ?? []) as { name: string }[]).map((f) => f.name),
      rows: (rows ?? []) as unknown[][],
    };
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
    await this.pools.clear();
  }
}

export const mysqlAdapter = new MysqlAdapter();
