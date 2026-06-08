import { ConnectionOptions } from '../interfaces/schema-provider.interface';
import { buildDb2ConnectionString } from './db2-connection';
import { DriverDetector } from './driver-detector';

export class ConnectionFactory {

  private static pools = new Map<string, any>();

  static async create(
    provider: string,
    options: ConnectionOptions
  ): Promise<any> {

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
       * DB2
       */
      case 'db2': {

        const ibmdb = DriverDetector.loadDriver('db2') as {
          open: (
            connStr: string,
            cb: (err: Error | null, conn: any) => void
          ) => void;
        };

        return this.openDb2Connection(
          ibmdb,
          connectionString
        );
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
   * Build connection string
   */
  private static buildConnectionString(
    provider: string,
    options: ConnectionOptions
  ): string {

    switch (provider) {

      case 'postgres': {

        if (
          options.connectionString?.trim()
        ) {
          return options.connectionString;
        }

        return [
          'postgresql://',
          encodeURIComponent(
            options.username ?? ''
          ),
          ':',
          encodeURIComponent(
            options.password ?? ''
          ),
          '@',
          options.host ?? 'localhost',
          ':',
          options.port ?? 5432,
          '/',
          options.database ?? ''
        ].join('');
      }

      case 'db2':

        return buildDb2ConnectionString(
          options,
          options.schema
        );

      default:

        throw new Error(
          `Connection string builder not implemented for ${provider}`
        );
    }
  }
}