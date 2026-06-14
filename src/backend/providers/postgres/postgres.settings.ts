import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const postgresSettings: ProviderConnectionSettings = {
  dialect: 'postgres',
  label: 'PostgreSQL',
  defaultPort: 5432,
  defaultSchema: 'public',

  buildConnectionString(option: ConnectionOptions): string {
    // postgres driver accepts a URL directly — honor a pre-built one
    if (option.connectionString?.trim()) return option.connectionString.trim();

    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    const username = encodeURIComponent(option.username || '');
    const password = encodeURIComponent(option.password || '');

    const params: string[] = [];
    if (option.ssl?.enabled) params.push('sslmode=require');
    if (option.schema) params.push(`options=${encodeURIComponent(`-csearch_path=${option.schema}`)}`);

    let url = `postgresql://${username}:${password}@${host}:${port}/${option.database || ''}`;
    if (params.length > 0) url += `?${params.join('&')}`;
    return url;
  },
};
