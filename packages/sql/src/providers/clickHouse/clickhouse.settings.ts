import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const clickHouseSettings: ProviderConnectionSettings = {
  dialect: 'clickhouse',
  label: 'ClickHouse',
  defaultPort: 8123,
  defaultSchema: 'default',
  schemaRequired: true,

  buildConnectionString(option: ConnectionOptions): string {
    if (option.connectionString?.trim()) return option.connectionString.trim();
    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    const proto = option.ssl?.enabled ? 'https' : 'http';
    return `${proto}://${host}:${port}`;
  },
};
