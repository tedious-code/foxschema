import { ProviderConnectionSettings } from '../interfaces/schema-provider.interface';
import { postgresSettings } from './postgres/postgres.settings';
import { mysqlSettings } from './mysql/mysql.settings';
import { db2Settings } from './db2/db2.settings';
import { mariaDbSettings } from './mariaDb/mariaDb.settings';
import { sqlServerSettings } from './sqlServer/sqlserver.settings';
import { oracleSettings } from './oracle/oracle.settings';
import { sqliteSettings } from './sqlLite/sqlLite.settings';
import { redshiftSettings } from './redshift/redshift.settings';
import { clickHouseSettings } from './clickHouse/clickhouse.settings';
import { azureSqlSettings } from './azureSql/azuresql.settings';
import { cockroachDbSettings } from './cockroachDb/cockroachdb.settings';
import { yugabyteDbSettings } from './yugabyteDb/yugabytedb.settings';
import { tiDbSettings } from './tiDb/tidb.settings';
import { duckDbSettings } from './duckDb/duckdb.settings';

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
};

export function getProviderSettings(dialect: string): ProviderConnectionSettings {
  const settings = PROVIDER_SETTINGS[dialect.toLowerCase()];
  if (!settings) {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
  return settings;
}
