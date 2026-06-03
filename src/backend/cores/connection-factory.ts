import { ConnectionOptions } from '../interfaces/schema-provider.interface';
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
    console.log(connectionString)
    switch (normalizedProvider) {

      /**
       * DB2
       */
      case 'db2': {
        const ibmdb = DriverDetector.loadDriver('db2') as {
          open: (connStr: string, cb: (err: Error | null, conn: unknown) => void) => void;
        };
        return this.openDb2Connection(ibmdb, connectionString);
      }

      /**
       * PostgreSQL
       */
      case 'postgres': {

        let pool =
          this.pools.get(poolKey);

        if (!pool) {

          const pg = DriverDetector.loadDriver('postgres') as {
            Pool: new (config: Record<string, unknown>) => { connect: () => Promise<unknown> };
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

          this.pools.set(poolKey, pool);
        }

        return pool.connect();
      }

      default:
        throw new Error(
          `Unsupported provider: ${provider}`
        );
    }
  }

  private static openDb2Connection(
    ibmdb: { open: (connStr: string, cb: (err: Error | null, conn: unknown) => void) => void },
    connectionString: string
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      ibmdb.open(connectionString, (err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });
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
          connection.close((err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
        break;

      case 'postgres':
        connection.release();
        break;
    }
  }

  /**
   * Build connection string if empty
   */
  private static buildConnectionString(
    provider: string,
    options: ConnectionOptions
  ): string {

    if (options.connectionString?.trim()) {
      return options.connectionString;
    }

    switch (provider) {

      case 'postgres': {

        return [
          'postgresql://',
          encodeURIComponent(options.username ?? ''),
          ':',
          encodeURIComponent(options.password ?? ''),
          '@',
          options.host ?? 'localhost',
          ':',
          options.port ?? 5432,
          '/',
          options.database ?? ''
        ].join('');
      }

      case 'db2': {

        return [
          `DATABASE=${options.database};`,
          `HOSTNAME=${options.host};`,
          `PORT=${options.port ?? 50000};`,
          'PROTOCOL=TCPIP;',
          `UID=${options.username};`,
          `PWD=${options.password};`,
          `CurrentSchema=${options.schema.toUpperCase()};`

        ].join('');
      }

      default:
        throw new Error(
          `Connection string builder not implemented for ${provider}`
        );
    }
  }
}