import { ConnectionOptions, ProviderConnectionSettings } from '../../interfaces/schema-provider.interface';

export const duckDbSettings: ProviderConnectionSettings = {
  dialect: 'duckdb',
  label: 'DuckDB',
  defaultPort: 0, // embedded — no network port
  defaultSchema: 'main',
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    // DuckDB connection is a file path (or ':memory:'), not a network address.
    if (option.connectionString?.trim()) return option.connectionString.trim();
    return option.database || ':memory:';
  },
};
