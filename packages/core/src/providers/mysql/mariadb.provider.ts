import { MysqlProvider } from './mysql.provider';

/**
 * MariaDB schema provider. MariaDB is wire- and catalog-compatible with MySQL
 * (same `information_schema`, same `mysql2` driver), so it reuses the entire
 * MySQL provider — only the dialect id differs so connection settings,
 * driver-adapter lookup, and labels resolve to the MariaDB registrations.
 */
export class MariadbProvider extends MysqlProvider {
  readonly provider = 'mariadb';
}
