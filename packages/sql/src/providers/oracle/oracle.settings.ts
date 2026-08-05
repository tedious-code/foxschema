import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const oracleSettings: ProviderConnectionSettings = {
  dialect: 'oracle',
  label: 'Oracle',
  defaultPort: 1521,
  defaultSchema: '',
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    if (option.connectionString?.trim()) return option.connectionString.trim();
    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    // Oracle Easy Connect format: host:port/service_name
    const service = option.database || 'ORCL';
    return `${host}:${port}/${service}`;
  },
};
