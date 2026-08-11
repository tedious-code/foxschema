/**
 * @foxschema/db — the Node runtime: drivers, pooling, and migration execution.
 *
 * Everything dialect-shaped (SQL generation, compare, splitting, type mapping)
 * lives in @foxschema/sql, which is pure and browser-safe. This package is the
 * half that needs sockets and native drivers, and it re-exports the pure half
 * so a Node consumer still has one import to reach for.
 *
 * If you are writing browser or otherwise runtime-neutral code, depend on
 * @foxschema/sql directly — importing this package drags in the driver layer.
 */

// The pure half, re-exported wholesale so backend code keeps one import.
export * from '@foxschema/sql';

// Runtime (Node-only)
export { ConnectionModule } from './modules/connection.module';
export { MigrationModule } from './modules/migration.module';
export { dialectSupportsTransactionalRollback } from './modules/dialect-transaction-support';
export { ConnectionFactory } from './cores/connection-factory';
export { DriverDetector } from './cores/driver-detector';
export { assertSafeIdentifier } from './cores/sql-identifier';
export {
  BoundedPoolCache,
  disposePoolEndOrClose,
  nonSecretFingerprint,
  credentialedCacheKey,
} from './cores/pool-cache';
export { setupDb2ClientEnv, hasDb2Clidriver } from './providers/db2/db2.env';

// Provider/adapter registries
export { getAdapter, ADAPTERS } from './providers/adapter-registry';
export { getRegisteredProvider, PROVIDERS } from './providers/provider-registry';
