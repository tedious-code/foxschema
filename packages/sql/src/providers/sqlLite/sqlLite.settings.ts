import { type ConnectionOptions, type ProviderConnectionSettings } from '../../interfaces/schema-provider.interface.js';

export const sqliteSettings: ProviderConnectionSettings = {
  dialect: 'sqlite',
  label: 'SQLite',
  defaultPort: 0,
  schemaRequired: false,

  buildConnectionString(option: ConnectionOptions): string {
    // SQLite connection is a file path, not a network address.
    if (option.connectionString?.trim()) return option.connectionString.trim();
    return option.database || ':memory:';
  },
};
