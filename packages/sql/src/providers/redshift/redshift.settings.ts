import { type ConnectionOptions, type ProviderConnectionSettings } from '../../interfaces/schema-provider.interface.js';

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
    // Do not put sslmode= in the URL. Recent node-pg maps require→verify-full and
    // rejects self-signed certs (local stand-in) even when the adapter passes
    // ssl: { rejectUnauthorized: false }. TLS is toggled via ConnectionOptions.ssl
    // → redshift.adapter Pool.ssl (UI defaults SSL on for Redshift).
    const params: string[] = [];
    if (option.schema) params.push(`options=${encodeURIComponent(`-csearch_path=${option.schema}`)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return `postgresql://${username}:${password}@${host}:${port}/${option.database || ''}${qs}`;
  },
};
