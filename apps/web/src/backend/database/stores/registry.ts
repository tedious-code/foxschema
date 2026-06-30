import type { Dialect, MetadataStore } from './types';
import type { MetadataDbConfig } from '../config';
import { SqliteStore } from './sqlite.store';
import { PostgresStore } from './postgres.store';
import { MysqlStore } from './mysql.store';

/**
 * Registry of metadata-store engines, keyed by dialect. Built-ins (sqlite /
 * postgres / mysql) are registered below; a deployment can `registerMetadataStore`
 * its own engine without touching the rest of the app — that's the extension point.
 */
export type MetadataStoreFactory = (config: MetadataDbConfig) => MetadataStore;

const REGISTRY = new Map<Dialect, MetadataStoreFactory>();

export function registerMetadataStore(engine: Dialect, factory: MetadataStoreFactory): void {
  REGISTRY.set(engine, factory);
}

export function supportedEngines(): Dialect[] {
  return [...REGISTRY.keys()];
}

export function createMetadataStore(config: MetadataDbConfig): MetadataStore {
  const factory = REGISTRY.get(config.engine);
  if (!factory) {
    throw new Error(
      `No metadata store registered for engine "${config.engine}". Registered: ${supportedEngines().join(', ')}.`
    );
  }
  return factory(config);
}

registerMetadataStore('sqlite', (c) => {
  if (!c.path) throw new Error('A SQLite database path is required.');
  return new SqliteStore(c.path);
});

registerMetadataStore('postgres', (c) => {
  if (!c.url) throw new Error('APP_DB_URL (a Postgres connection string) is required for the postgres engine.');
  return new PostgresStore(c.url);
});

registerMetadataStore('mysql', (c) => {
  if (!c.url) throw new Error('APP_DB_URL (a MySQL connection string) is required for the mysql engine.');
  return new MysqlStore(c.url);
});
