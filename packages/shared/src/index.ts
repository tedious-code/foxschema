// @foxschema/shared — the browser-safe public surface of the engine: types, the
// pure diff + DDL generators, and connection-string formats. Contains NO
// database drivers or node:* runtime, so it is safe to bundle into a frontend.

export * from './editions';
export * from './interfaces/schema.interface';
export type {
  ConnectionOptions,
  SchemaProvider,
  DriverInfo,
  SavedConnection,
  ProviderConnectionSettings,
  DriverAdapter,
} from './interfaces/schema-provider.interface';
export * from './interfaces/diff.types.interface';
export type { MigrationEvent } from './interfaces/migration.types';

export { CompareModule } from './modules/compare.module';
export { SqlGeneratorModule } from './modules/sql-generator.module';
export type { MigrationStep, SchemaMapping } from './modules/sql-generator.module';

export { buildConnectionString, withConnectionString, DEFAULT_PORTS } from './cores/connection-string';
export { PROVIDER_SETTINGS, getProviderSettings } from './providers/provider-settings';
