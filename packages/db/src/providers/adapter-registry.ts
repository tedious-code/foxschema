import { DriverAdapter } from '@foxschema/sql';
import { db2Adapter } from './db2/db2.adapter';
import { postgresAdapter } from './postgres/postgres.adapter';
import { mysqlAdapter } from './mysql/mysql.adapter';
import { sqlServerAdapter } from './sqlServer/sqlserver.adapter';
import { oracleAdapter } from './oracle/oracle.adapter';
import { sqliteAdapter } from './sqlLite/sqlLite.adapter';
import { redshiftAdapter } from './redshift/redshift.adapter';
import { clickHouseAdapter } from './clickHouse/clickhouse.adapter';
import { azureSqlAdapter } from './azureSql/azuresql.adapter';
import { duckDbAdapter } from './duckDb/duckdb.adapter';
import { mongoDbAdapter } from './mongodb/mongodb.adapter';
import { redisAdapter } from './redis/redis.adapter';

// Register a dialect's native driver adapter here — one line per platform.
// MariaDB shares the mysql2 adapter (same wire protocol & driver).
export const ADAPTERS: Record<string, DriverAdapter> = {
  [db2Adapter.dialect]: db2Adapter,
  [postgresAdapter.dialect]: postgresAdapter,
  cockroachdb: postgresAdapter, // Postgres wire-compatible — shares the pg adapter.
  yugabytedb: postgresAdapter,  // Postgres wire-compatible — shares the pg adapter.
  [mysqlAdapter.dialect]: mysqlAdapter,
  mariadb: mysqlAdapter, // MariaDB shares the mysql2 adapter (same wire protocol & driver).
  tidb: mysqlAdapter,    // MySQL wire-compatible — shares the mysql2 adapter.
  [sqlServerAdapter.dialect]: sqlServerAdapter,
  [oracleAdapter.dialect]: oracleAdapter,
  [sqliteAdapter.dialect]: sqliteAdapter,
  // Not SQL engines: statements are translated by parseSqlSubset. They are
  // registered for the editor and data migrate only — schema diff does not
  // apply to a schemaless store, so neither appears in DIALECT_MAP.
  [mongoDbAdapter.dialect]: mongoDbAdapter,
  [redisAdapter.dialect]: redisAdapter,
  [redshiftAdapter.dialect]: redshiftAdapter,
  [clickHouseAdapter.dialect]: clickHouseAdapter,
  [azureSqlAdapter.dialect]: azureSqlAdapter,
  [duckDbAdapter.dialect]: duckDbAdapter,
};

export function getAdapter(dialect: string): DriverAdapter {
  const adapter = ADAPTERS[dialect.toLowerCase()];
  if (!adapter) {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
  return adapter;
}
