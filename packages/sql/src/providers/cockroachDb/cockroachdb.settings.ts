import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const cockroachDbSettings: ProviderConnectionSettings = {
  dialect: 'cockroachdb',
  label: 'CockroachDB',
  defaultPort: 26257, // CockroachDB's default SQL port (not Postgres' 5432)
  defaultSchema: 'public',
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    if (option.connectionString?.trim()) return option.connectionString.trim();
    const host = option.host || 'localhost';
    const port = option.port || this.defaultPort;
    const username = encodeURIComponent(option.username || '');
    const password = encodeURIComponent(option.password || '');
    const params: string[] = [];
    // CockroachDB Cloud/secure clusters require TLS; local `--insecure` doesn't.
    if (option.ssl?.enabled) params.push('sslmode=require');
    if (option.schema) params.push(`options=${encodeURIComponent(`-csearch_path=${option.schema}`)}`);
    let url = `postgresql://${username}:${password}@${host}:${port}/${option.database || ''}`;
    if (params.length) url += `?${params.join('&')}`;
    return url;
  },
};
