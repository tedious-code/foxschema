// @foxschema/core — the full Node engine. Interfaces, pure modules, and all
// database providers. No dependency on @foxschema/shared.

// Types & interfaces
export * from './interfaces/schema.interface';
export type {
  ConnectionOptions,
  SchemaProvider,
  RoleLoadResult,
  DriverInfo,
  SavedConnection,
  ProviderConnectionSettings,
  DriverAdapter,
} from './interfaces/schema-provider.interface';
export * from './interfaces/diff.types.interface';
export type { MigrationEvent } from './interfaces/migration.types';

// Pure modules (no Node deps)
export { CompareModule } from './modules/compare.module';
export { SqlGeneratorModule } from './modules/sql-generator.module';
export type { MigrationStep, SchemaMapping } from './modules/sql-generator.module';
export { findDropDependencies } from './modules/dependency-scan';
export type { DropDependency, DropDependencyOptions } from './modules/dependency-scan';
export { findMissingFkTargets, findNarrowingTypeChanges, extractReviewNotices, validateMigrationPlan } from './modules/migration-validation';
export type { ValidationIssue, ValidationSeverity, ValidationCode } from './modules/migration-validation';
export { buildBrowseResult } from './modules/browse';
export type { SqlDialect, CanonicalType, CanonicalBase, RenderedType } from './modules/sql-dialect.interface';
export { resolveDialect, DIALECT_MAP } from './modules/dialect-registry';

// Connection-string helpers
export { buildConnectionString, withConnectionString, DEFAULT_PORTS } from './cores/connection-string';

// Provider settings (browser-safe per-dialect config)
export { PROVIDER_SETTINGS, getProviderSettings } from './providers/provider-settings';

// Runtime (Node-only)
export { ConnectionModule } from './modules/connection.module';
export { MigrationModule } from './modules/migration.module';
export { ConnectionFactory } from './cores/connection-factory';
export { DriverDetector } from './cores/driver-detector';
export { assertSafeIdentifier } from './cores/sql-identifier';
export { setupDb2ClientEnv } from './providers/db2/db2.env';

// Provider/adapter registries
export { getAdapter, ADAPTERS } from './providers/adapter-registry';
export { getRegisteredProvider, PROVIDERS } from './providers/provider-registry';
