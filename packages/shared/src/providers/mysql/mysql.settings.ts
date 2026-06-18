import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const mysqlSettings: ProviderConnectionSettings = {
  dialect: 'mysql',
  label: 'MySQL',
  defaultPort: 3306,
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    // mysql driver accepts a URL directly — honor a pre-built one
    if (option.connectionString?.trim()) return option.connectionString.trim();

    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    const username = encodeURIComponent(option.username || '');
    const password = encodeURIComponent(option.password || '');

    let url = `mysql://${username}:${password}@${host}:${port}/${option.database || ''}`;
    if (option.ssl?.enabled) url += `?ssl=true`;
    return url;
  },
};
