import { MysqlProvider } from '../mysql/mysql.provider';

/**
 * TiDB schema provider. TiDB speaks the MySQL wire protocol and exposes a
 * MySQL-compatible `information_schema` through the same `mysql2` driver, so it
 * reuses the entire MySQL provider. Only the dialect id differs so settings,
 * adapter lookup, and labels resolve to the TiDB registrations.
 *
 * (TiDB historically lacks triggers/stored procedures — the inherited
 * information_schema queries simply return no rows for those, which is correct.
 * Refine here only if a real divergence surfaces, as MariadbProvider does.)
 */
export class TiDbProvider extends MysqlProvider {
  readonly provider = 'tidb';
}
