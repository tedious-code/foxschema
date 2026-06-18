import { ProviderConnectionSettings } from '../interfaces/schema-provider.interface';
import { postgresSettings } from './postgres/postgres.settings';
import { mysqlSettings } from './mysql/mysql.settings';
import { db2Settings } from './db2/db2.settings';

// Register a new dialect by adding its settings here — nothing else changes
export const PROVIDER_SETTINGS: Record<string, ProviderConnectionSettings> = {
  [postgresSettings.dialect]: postgresSettings,
  [mysqlSettings.dialect]: mysqlSettings,
  [db2Settings.dialect]: db2Settings,
};

export function getProviderSettings(dialect: string): ProviderConnectionSettings {
  const settings = PROVIDER_SETTINGS[dialect.toLowerCase()];
  if (!settings) {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
  return settings;
}
