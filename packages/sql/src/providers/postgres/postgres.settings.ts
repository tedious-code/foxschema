import { type ConnectionOptions, type ProviderConnectionSettings } from '../../interfaces/schema-provider.interface.js';

export const postgresSettings: ProviderConnectionSettings = {
  dialect: 'postgres',
  label: 'PostgreSQL',
  defaultPort: 5432,
  defaultSchema: 'public',
  /**
   * PostgreSQL resolves unqualified names through `search_path`, which defaults
   * to `public`. A connection with no schema set is therefore a working
   * connection, so requiring one rejects something legitimate.
   *
   * This said `true` while the browser connection form said `false`, and the
   * two were never reconciled. The visible effect was not a cosmetic
   * disagreement: the form marked Schema "(optional)" and saved happily, then
   * `POST /schema/load` — which reads *this* value
   * (`packages/server/src/features/schema/schema.routes.ts`) — refused the
   * connection with "PostgreSQL requires a schema". The two Postgres-wire
   * dialects beside it, CockroachDB and YugabyteDB, both already said `false`.
   */
  schemaRequired: false,

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
