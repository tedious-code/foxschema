import { DriverAdapter } from '../interfaces/schema-provider.interface';
import { db2Adapter } from './db2/db2.adapter';
import { postgresAdapter } from './postgres/postgres.adapter';
import { mysqlAdapter } from './mysql/mysql.adapter';

// Register a dialect's native driver adapter here — one line per platform.
export const ADAPTERS: Record<string, DriverAdapter> = {
  [db2Adapter.dialect]: db2Adapter,
  [postgresAdapter.dialect]: postgresAdapter,
  [mysqlAdapter.dialect]: mysqlAdapter,
};

export function getAdapter(dialect: string): DriverAdapter {
  const adapter = ADAPTERS[dialect.toLowerCase()];
  if (!adapter) {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
  return adapter;
}
