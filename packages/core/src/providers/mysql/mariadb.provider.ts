import { MysqlProvider } from './mysql.provider';
import { ConnectionFactory } from '../../cores/connection-factory';
import { groupRoleRows } from '../../cores/schema-to-tables';
import { ConnectionOptions, DbRole, DbSequence } from '../../interfaces';

interface MariaSequenceRaw {
  minimum_value: string;
  maximum_value: string;
  start_value: string;
  increment: string;
  cache_size: string;
  cycle_option: number;
}

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

  /**
   * MariaDB (10.3+) has real CREATE SEQUENCE — implemented as a special one-row
   * table, so its defined parameters (as opposed to the current runtime position)
   * live in that pseudo-table's own columns rather than a shared catalog view.
   */
  protected async fetchSequences(options: ConnectionOptions, db: string): Promise<Record<string, DbSequence[]>> {
    const names = await ConnectionFactory.executeQuery<{ TABLE_NAME: string }>(
      this.provider,
      options,
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'SEQUENCE' ORDER BY TABLE_NAME`,
      [db]
    );

    const sequences: Record<string, DbSequence[]> = {};
    await Promise.all(
      names.map(async ({ TABLE_NAME: name }) => {
        const rows = await ConnectionFactory.executeQuery<MariaSequenceRaw>(
          this.provider,
          options,
          `SELECT minimum_value, maximum_value, start_value, increment, cache_size, cycle_option
           FROM \`${db}\`.\`${name}\``
        );
        const s = rows[0];
        if (!s) return;
        sequences[name] = [{
          name,
          schema: db,
          startValue: String(s.start_value),
          increment: String(s.increment),
          minValue: String(s.minimum_value),
          maxValue: String(s.maximum_value),
          cycle: Number(s.cycle_option) === 1,
          cache: Number(s.cache_size),
        }];
      })
    );
    return sequences;
  }
}
