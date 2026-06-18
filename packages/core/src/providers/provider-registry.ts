import { SchemaProvider } from '@foxschema/shared';
import { Db2Provider } from './db2/db2.provider';
import { PostgresProvider } from './postgres/postgres.provider';
import { MysqlProvider } from './mysql/mysql.provider';

// Register a dialect's schema provider (queries) here — one line per platform.
export const PROVIDERS: Record<string, SchemaProvider> = {
  db2: new Db2Provider(),
  postgres: new PostgresProvider(),
  mysql: new MysqlProvider(),
};

export function getRegisteredProvider(dialect: string): SchemaProvider {
  const provider = PROVIDERS[dialect.toLowerCase()];
  if (!provider) {
    throw new Error(`No provider registered for dialect: ${dialect}`);
  }
  return provider;
}
