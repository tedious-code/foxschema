import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const yugabyteDbSettings: ProviderConnectionSettings = {
  dialect: 'yugabytedb',
  label: 'YugabyteDB',
  defaultPort: 5433, // YSQL's default port (YugabyteDB reserves 5432-style semantics on 5433)
  defaultSchema: 'public',
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    if (option.connectionString?.trim()) return option.connectionString.trim();
    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    const username = encodeURIComponent(option.username || '');
    const password = encodeURIComponent(option.password || '');
    const params: string[] = [];
    if (option.ssl?.enabled) params.push('sslmode=require');
    if (option.schema) params.push(`options=${encodeURIComponent(`-csearch_path=${option.schema}`)}`);
    let url = `postgresql://${username}:${password}@${host}:${port}/${option.database || ''}`;
    if (params.length) url += `?${params.join('&')}`;
    return url;
  },
};
