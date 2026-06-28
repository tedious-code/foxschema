import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const sqlServerSettings: ProviderConnectionSettings = {
  dialect: 'sqlserver',
  label: 'SQL Server',
  defaultPort: 1433,
  defaultSchema: 'dbo',
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    if (option.connectionString?.trim()) return option.connectionString.trim();
    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    const encrypt = option.ssl?.enabled ? 'Encrypt=True;' : 'Encrypt=False;';
    const trust = option.ssl?.rejectUnauthorized === false ? 'TrustServerCertificate=True;' : '';
    return `Server=${host},${port};Database=${option.database || ''};User Id=${option.username || ''};Password=${option.password || ''};${encrypt}${trust}`;
  },
};
