import { ConnectionOptions } from '../interfaces/schema-provider.interface';
import { getProviderSettings } from '../providers/provider-settings';
import { DriverDetector } from './driver-detector';

export class ConnectionFactory {

  private static pools = new Map<string, any>();

  static async create(
    provider: string,
    options: ConnectionOptions,
    opts: { pooled?: boolean } = {}
  ): Promise<any> {

    const pooled = opts.pooled !== false;

    const normalizedProvider =
      provider.toLowerCase();

    const connectionString =
      this.buildConnectionString(
        normalizedProvider,
        options
      );

    const poolKey =
      `${normalizedProvider}:${connectionString}`;

    switch (normalizedProvider) {

      /**
       * DB2 — pooled via ibm_db's built-in Pool so each schema load reuses
       * connections instead of paying the (expensive) DB2 connect cost per op.
       */
      case 'db2': {

        const ibmdb = DriverDetector.loadDriver('db2') as {
          Pool?: new () => any;
          open: (
            connStr: string,
            cb: (err: Error | null, conn: any) => void
          ) => void;
        };

        // Transactional callers (migrations) want a dedicated connection so a
        // mid-transaction connection is never returned to the shared pool.
        // Older ibm_db builds may also lack Pool — fall back to a raw open.
        if (!pooled || !ibmdb.Pool) {
          return this.openDb2Connection(ibmdb, connectionString);
        }

        let pool = this.pools.get(poolKey);
        if (!pool) {
          pool = new ibmdb.Pool();
          if (typeof pool.setMaxPoolSize === 'function') {
            pool.setMaxPoolSize(options.pool?.max ?? 10);
          }
          if (typeof pool.setConnectTimeout === 'function' && options.timeout?.connectMs) {
            pool.setConnectTimeout(Math.ceil(options.timeout.connectMs / 1000));
          }
          if (typeof pool.setIdleTimeout === 'function' && options.pool?.idleTimeoutMs) {
            pool.setIdleTimeout(Math.ceil(options.pool.idleTimeoutMs / 1000));
          }
          this.pools.set(poolKey, pool);
        }

        return new Promise((resolve, reject) => {
          pool.open(connectionString, (err: Error | null, conn: any) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(conn);
          });
        });
      }

      /**
       * PostgreSQL
       */
      case 'postgres': {

        let pool =
          this.pools.get(poolKey);

        if (!pool) {

          const pg = DriverDetector.loadDriver('postgres') as {
            Pool: new (config: Record<string, unknown>) => any;
          };

          pool = new pg.Pool({

            connectionString,

            max:
              options.pool?.max ?? 10,

            min:
              options.pool?.min ?? 1,

            idleTimeoutMillis:
              options.pool?.idleTimeoutMs ?? 30000,

            connectionTimeoutMillis:
              options.timeout?.connectMs ?? 10000,

            ssl:
              options.ssl?.enabled
                ? {
                    rejectUnauthorized:
                      options.ssl.rejectUnauthorized ?? false,

                    ca: options.ssl.ca,
                    cert: options.ssl.cert,
                    key: options.ssl.key
                  }
                : false
          });

          this.pools.set(
            poolKey,
            pool
          );
        }

        return pool.connect();
      }

      default:
        throw new Error(
          `Unsupported provider: ${provider}`
        );
    }
  }

  static async close(
    provider: string,
    connection: any
  ): Promise<void> {

    if (!connection) {
      return;
    }

    switch (provider.toLowerCase()) {

      case 'db2':

        await new Promise<void>((resolve, reject) => {

          connection.close(
            (err: Error | null) => {

              if (err) {
                reject(err);
                return;
              }

              resolve();
            }
          );
        });

        break;

      case 'postgres':

        connection.release();

        break;
    }
  }

  /**
   * Closes every pooled connection. Call on graceful shutdown so the process
   * can exit cleanly instead of hanging on open DB handles.
   */
  static async closeAll(): Promise<void> {
    const entries = Array.from(this.pools.entries());
    this.pools.clear();

    await Promise.all(
      entries.map(async ([key, pool]) => {
        try {
          if (key.startsWith('postgres:') && typeof pool.end === 'function') {
            await pool.end();
          } else if (key.startsWith('db2:') && typeof pool.close === 'function') {
            await new Promise<void>((resolve) => pool.close(() => resolve()));
          }
        } catch (err) {
          console.error(`Error closing pool ${key.split(':')[0]}:`, err);
        }
      })
    );
  }

  /**
   * Generic query executor
   */
  static async executeQuery<T = Record<string, unknown>>(
    provider: string,
    options: ConnectionOptions,
    sql: string,
    params: readonly unknown[] = []
  ): Promise<T[]> {

    const connection =
      await this.create(
        provider,
        options
      );

    try {

      switch (
        provider.toLowerCase()
      ) {

        case 'db2':

          return await this.executeDb2<T>(
            connection,
            sql,
            params
          );

        case 'postgres':

          return await this.executePostgres<T>(
            connection,
            sql,
            params
          );

        default:

          throw new Error(
            `Unsupported provider: ${provider}`
          );
      }

    } finally {

      await this.close(
        provider,
        connection
      );
    }
  }

  /**
   * Execute query using existing connection
   * Useful when loading entire schema
   */
  static async executeOnConnection<T = Record<string, unknown>>(
    provider: string,
    connection: any,
    sql: string,
    params: readonly unknown[] = []
  ): Promise<T[]> {

    switch (
      provider.toLowerCase()
    ) {

      case 'db2':

        return this.executeDb2<T>(
          connection,
          sql,
          params
        );

      case 'postgres':

        return this.executePostgres<T>(
          connection,
          sql,
          params
        );

      default:

        throw new Error(
          `Unsupported provider: ${provider}`
        );
    }
  }

  private static executeDb2<T>(
    connection: any,
    sql: string,
    params: readonly unknown[]
  ): Promise<T[]> {

    return new Promise<T[]>(
      (resolve, reject) => {

        connection.query(
          sql,
          [...params],
          (
            err: Error | null,
            rows: T[]
          ) => {

            if (err) {
              reject(err);
              return;
            }

            resolve(
              rows ?? []
            );
          }
        );
      }
    );
  }

  private static async executePostgres<T>(
    connection: any,
    sql: string,
    params: readonly unknown[]
  ): Promise<T[]> {

    const result =
      await connection.query(
        sql,
        params
      );

    return result.rows as T[];
  }

  private static openDb2Connection(
    ibmdb: {
      open: (
        connStr: string,
        cb: (
          err: Error | null,
          conn: any
        ) => void
      ) => void;
    },
    connectionString: string
  ): Promise<any> {

    return new Promise(
      (resolve, reject) => {

        ibmdb.open(
          connectionString,
          (
            err,
            conn
          ) => {

            if (err) {
              reject(err);
              return;
            }

            resolve(conn);
          }
        );
      }
    );
  }

  /**
   * Build the driver-ready connection string via the provider's own format —
   * the single source of truth shared with the frontend.
   */
  private static buildConnectionString(
    provider: string,
    options: ConnectionOptions
  ): string {
    return getProviderSettings(provider).buildConnectionString(options);
  }
}