import type { Dialect, MetadataStore } from './types';
import type { MetadataDbConfig } from '../config';
import { SqliteStore } from './sqlite.provider';
import { PostgresStore } from './postgres.provider';
import { MysqlStore } from './mysql.provider';

/**
 * Registry of metadata-store providers, keyed by engine. Built-ins (sqlite /
 * postgres / mysql) are registered below; a deployment can `registerMetadataProvider`
 * its own engine without touching the rest of the app — that's the extension point.
 */
export type MetadataProviderFactory = (config: MetadataDbConfig) => MetadataStore;

const REGISTRY = new Map<Dialect, MetadataProviderFactory>();

export function registerMetadataProvider(engine: Dialect, factory: MetadataProviderFactory): void {
  REGISTRY.set(engine, factory);
}

export function supportedEngines(): Dialect[] {
  return [...REGISTRY.keys()];
}

export function createMetadataStore(config: MetadataDbConfig): MetadataStore {
  const factory = REGISTRY.get(config.engine);
  if (!factory) {
    throw new Error(
      `No metadata-store provider registered for engine "${config.engine}". Registered: ${supportedEngines().join(', ')}.`
    );
  }
  return factory(config);
}

registerMetadataProvider('sqlite', (c) => {
  if (!c.path) throw new Error('A SQLite database path is required.');
  return new SqliteStore(c.path);
});

registerMetadataProvider('postgres', (c) => {
  if (!c.url) throw new Error('APP_DB_URL (a Postgres connection string) is required for the postgres engine.');
  return new PostgresStore(c.url);
});

registerMetadataProvider('mysql', (c) => {
  if (!c.url) throw new Error('APP_DB_URL (a MySQL connection string) is required for the mysql engine.');
  return new MysqlStore(c.url);
});
