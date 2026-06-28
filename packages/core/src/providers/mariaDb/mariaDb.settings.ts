import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const mariaDbSettings: ProviderConnectionSettings = {
  // MariaDB speaks the MySQL wire protocol and is driven by the same `mysql2`
  // adapter, so the connection string is a plain mysql:// URL the driver
  // understands. The canonical id is lowercase to match the registry lookups.
  dialect: 'mariadb',
  label: 'MariaDB',
  defaultPort: 3306,
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    // mysql2 accepts a URL directly — honor a pre-built one
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
