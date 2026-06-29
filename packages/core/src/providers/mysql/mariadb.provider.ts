import { MysqlProvider } from './mysql.provider';
import { ConnectionFactory } from '../../cores/connection-factory';
import { groupRoleRows } from '../../cores/schema-to-tables';
import { ConnectionOptions, DbRole } from '../../interfaces';

/**
 * MariaDB schema provider. MariaDB is wire- and catalog-compatible with MySQL
 * (same `information_schema`, same `mysql2` driver), so it reuses the entire
 * MySQL provider — only the dialect id differs so connection settings,
 * driver-adapter lookup, and labels resolve to the MariaDB registrations.
 */
export class MariadbProvider extends MysqlProvider {
  readonly provider = 'mariadb';

  /**
   * MariaDB models roles differently from MySQL 8: grants live in
   * `mysql.roles_mapping` (Role ← User), not `mysql.role_edges`.
   */
  protected async fetchRoles(options: ConnectionOptions): Promise<DbRole[]> {
    const rows = await ConnectionFactory.executeQuery<{ role_name: string; member: string | null }>(
      this.provider,
      options,
      `SELECT Role AS role_name, User AS member
       FROM mysql.roles_mapping
       WHERE Role <> ''
       ORDER BY Role, User`
    );
    return groupRoleRows(rows);
  }
}
