// @foxschema/core — the full Node engine. Re-exports the browser-safe surface
// (@foxschema/shared) plus the runtime pieces that touch databases (drivers,
// pooling, migration execution).

export * from '@foxschema/shared';

export { ConnectionModule } from './modules/connection.module';
export { MigrationModule } from './modules/migration.module';
export { ConnectionFactory } from './cores/connection-factory';
export { DriverDetector } from './cores/driver-detector';
export { assertSafeIdentifier } from './cores/sql-identifier';
export { setupDb2ClientEnv } from './providers/db2/db2.env';

// Provider/adapter registries + extension point for community-contributed dialects
export { getAdapter, ADAPTERS } from './providers/adapter-registry';
export { getRegisteredProvider, PROVIDERS } from './providers/provider-registry';
