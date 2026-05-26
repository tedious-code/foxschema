import { ConnectionOptions } from './connection-options';
import { DriverDetector } from './driver-detector';

export class ConnectionFactory {

  static pools = new Map<string, any>();

  static async create(
    provider: string,
    options: ConnectionOptions
  ): Promise<any> {

    switch (provider) {

      /**
       * DB2
       */
      case 'db2': {

        const ibmdb =
          await DriverDetector.loadDriver('db2');

        // Reuse pool
        if (this.pools.has(options.connectionString)) {
          return this.pools.get(options.connectionString);
        }

        const pool = new ibmdb.Pool();

        pool.init(
          options.pool?.max ?? 10,
          options.connectionString
        );

        this.pools.set(
          options.connectionString,
          pool
        );

        return new Promise((resolve, reject) => {

          pool.open(
            options.connectionString,
            (err: any, conn: any) => {

              if (err) {
                reject(err);
                return;
              }

              resolve(conn);
            }
          );
        });
      }

      /**
       * PostgreSQL
       */
      case 'postgres': {

        const pg =
          await DriverDetector.loadDriver('postgres');

        const pool = new pg.Pool({

          connectionString:
            options.connectionString,

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

    switch (provider) {

      case 'db2':
        await connection.close();
        break;

      case 'postgres':
        connection.release();
        break;
    }
  }
}