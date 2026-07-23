// Browser-safe exports — pure logic only, no Node.js built-ins.
// Import from '@foxschema/core/browser' in frontend code.

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
export { findDropDependencies } from './modules/dependency-scan';
export type { DropDependency, DropDependencyOptions } from './modules/dependency-scan';
export { findMissingFkTargets, findNarrowingTypeChanges, extractReviewNotices, validateMigrationPlan } from './modules/migration-validation';
export type { ValidationIssue, ValidationSeverity, ValidationCode } from './modules/migration-validation';
export { CROSS_DIALECT_READINESS } from './modules/cross-dialect-readiness';
export type { ObjectTypeReadiness, ReadinessLevel } from './modules/cross-dialect-readiness';
export { buildBrowseResult } from './modules/browse';
export { splitSqlStatements, checkStatement, isWriteStatement, firstKeyword, extractTableAliases, statementVerb, isMutatingDmlStatement, dmlLacksWhere } from './modules/sql-splitter';
export type { SplitStatement, StatementStatus } from './modules/sql-splitter';
export type { SqlDialect, CanonicalType, CanonicalBase, RenderedType } from './modules/sql-dialect.interface';
export { resolveDialect, DIALECT_MAP } from './modules/dialect-registry';

export { buildConnectionString, withConnectionString, DEFAULT_PORTS } from './cores/connection-string';
export { PROVIDER_SETTINGS, getProviderSettings } from './providers/provider-settings';
