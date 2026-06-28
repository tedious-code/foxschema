import { DriverAdapter } from '../interfaces';
import { db2Adapter } from './db2/db2.adapter';
import { postgresAdapter } from './postgres/postgres.adapter';
import { mysqlAdapter } from './mysql/mysql.adapter';
import { sqlServerAdapter } from './sqlServer/sqlserver.adapter';
import { oracleAdapter } from './oracle/oracle.adapter';
import { sqliteAdapter } from './sqlLite/sqlLite.adapter';

// Register a dialect's native driver adapter here — one line per platform.
// MariaDB shares the mysql2 adapter (same wire protocol & driver).
export const ADAPTERS: Record<string, DriverAdapter> = {
  [db2Adapter.dialect]: db2Adapter,
  [postgresAdapter.dialect]: postgresAdapter,
  [mysqlAdapter.dialect]: mysqlAdapter,
  mariadb: mysqlAdapter,
  [sqlServerAdapter.dialect]: sqlServerAdapter,
  [oracleAdapter.dialect]: oracleAdapter,
  [sqliteAdapter.dialect]: sqliteAdapter,
};

export function getAdapter(dialect: string): DriverAdapter {
  const adapter = ADAPTERS[dialect.toLowerCase()];
  if (!adapter) {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
  return adapter;
}
