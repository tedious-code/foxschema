import { PostgresProvider } from '../postgres/postgres.provider';

/**
 * YugabyteDB schema provider. YugabyteDB's YSQL API reuses the actual PostgreSQL
 * query layer (same `pg_catalog` / `information_schema`, same `pg` driver), so it
 * is even closer to Postgres than CockroachDB and reuses the entire Postgres
 * provider. Only the dialect id differs so settings, adapter lookup, and labels
 * resolve to the YugabyteDB registrations.
 */
export class YugabyteDbProvider extends PostgresProvider {
  readonly provider = 'yugabytedb';
}
