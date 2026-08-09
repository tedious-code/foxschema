import { type ProviderConnectionSettings } from '../interfaces/schema-provider.interface.js';
import { postgresSettings } from './postgres/postgres.settings.js';
import { mysqlSettings } from './mysql/mysql.settings.js';
import { db2Settings } from './db2/db2.settings.js';
import { mariaDbSettings } from './mariaDb/mariaDb.settings.js';
import { sqlServerSettings } from './sqlServer/sqlserver.settings.js';
import { oracleSettings } from './oracle/oracle.settings.js';
import { sqliteSettings } from './sqlLite/sqlLite.settings.js';
import { redshiftSettings } from './redshift/redshift.settings.js';
import { clickHouseSettings } from './clickHouse/clickhouse.settings.js';
import { azureSqlSettings } from './azureSql/azuresql.settings.js';
import { cockroachDbSettings } from './cockroachDb/cockroachdb.settings.js';
import { yugabyteDbSettings } from './yugabyteDb/yugabytedb.settings.js';
import { tiDbSettings } from './tiDb/tidb.settings.js';
import { duckDbSettings } from './duckDb/duckdb.settings.js';
import { redisSettings } from './redis/redis.settings.js';
import { mongoDbSettings } from './mongodb/mongodb.settings.js';

// Register a new dialect by adding its settings here — nothing else changes
export const PROVIDER_SETTINGS: Record<string, ProviderConnectionSettings> = {
  [postgresSettings.dialect]: postgresSettings,
  [mysqlSettings.dialect]: mysqlSettings,
  [mariaDbSettings.dialect]: mariaDbSettings,
  [db2Settings.dialect]: db2Settings,
  [sqlServerSettings.dialect]: sqlServerSettings,
  [oracleSettings.dialect]: oracleSettings,
  [sqliteSettings.dialect]: sqliteSettings,
  [redshiftSettings.dialect]: redshiftSettings,
  [clickHouseSettings.dialect]: clickHouseSettings,
  [azureSqlSettings.dialect]: azureSqlSettings,
  [cockroachDbSettings.dialect]: cockroachDbSettings,
  [yugabyteDbSettings.dialect]: yugabyteDbSettings,
  [tiDbSettings.dialect]: tiDbSettings,
  [duckDbSettings.dialect]: duckDbSettings,
  // Not SQL engines — statements are translated by parseSqlSubset. They are
  // here so a connection can be created and used from the SQL editor and data
  // migrate; they are deliberately absent from DIALECT_MAP, which drives
  // schema diff and DDL generation.
  [redisSettings.dialect]: redisSettings,
  [mongoDbSettings.dialect]: mongoDbSettings,
};

export function getProviderSettings(dialect: string): ProviderConnectionSettings {
  const settings = PROVIDER_SETTINGS[dialect.toLowerCase()];
  if (!settings) {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
  return settings;
}
