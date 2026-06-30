import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const redshiftSettings: ProviderConnectionSettings = {
  dialect: 'redshift',
  label: 'Amazon Redshift',
  defaultPort: 5439,
  defaultSchema: 'public',
  schemaRequired: true,

  buildConnectionString(option: ConnectionOptions): string {
    if (option.connectionString?.trim()) return option.connectionString.trim();
    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    const username = encodeURIComponent(option.username || '');
    const password = encodeURIComponent(option.password || '');
    const params: string[] = ['sslmode=require'];
    if (option.schema) params.push(`options=${encodeURIComponent(`-csearch_path=${option.schema}`)}`);
    return `postgresql://${username}:${password}@${host}:${port}/${option.database || ''}?${params.join('&')}`;
  },
};
