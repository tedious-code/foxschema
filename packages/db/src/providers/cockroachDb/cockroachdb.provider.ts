import { PostgresProvider } from '../postgres/postgres.provider';

/**
 * CockroachDB schema provider. CockroachDB is PostgreSQL wire- and
 * catalog-compatible — it serves `pg_catalog` / `information_schema` through the
 * same `pg` driver — so it reuses the entire Postgres provider. Only the dialect
 * id differs, so connection settings, driver-adapter lookup, and labels resolve
 * to the CockroachDB registrations.
 *
 * (If CockroachDB-specific introspection divergences surface later — e.g. its
 * lack of stored procedures pre-23.1, or crdb_internal catalogs — override the
 * relevant fetch* methods here, the way MariadbProvider refines MysqlProvider.)
 */
export class CockroachDbProvider extends PostgresProvider {
  readonly provider = 'cockroachdb';
}
