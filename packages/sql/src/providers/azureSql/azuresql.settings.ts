import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const azureSqlSettings: ProviderConnectionSettings = {
  dialect: 'azuresql',
  label: 'Azure SQL',
  defaultPort: 1433,
  defaultSchema: 'dbo',
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    if (option.connectionString?.trim()) return option.connectionString.trim();
    const host = option.host || '';
    const port = option.port || this.defaultPort;
    // Azure SQL always requires encryption; trust the server cert only if explicitly overridden.
    const trust = option.ssl?.rejectUnauthorized === false ? 'TrustServerCertificate=True;' : '';
    return `Server=${host},${port};Database=${option.database || ''};User Id=${option.username || ''};Password=${option.password || ''};Encrypt=True;${trust}`;
  },
};
