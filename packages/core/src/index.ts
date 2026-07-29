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
export { dialectSupportsFk } from './modules/dialect-fk-support';
export type { FkFeatureSupport } from './modules/dialect-fk-support';
export { dialectSupportsIndex } from './modules/dialect-index-support';
export type { IndexFeatureSupport } from './modules/dialect-index-support';
export { findMissingFkTargets, findNarrowingTypeChanges, extractReviewNotices, validateMigrationPlan } from './modules/migration-validation';
export type { ValidationIssue, ValidationSeverity, ValidationCode } from './modules/migration-validation';
export { CROSS_DIALECT_READINESS } from './modules/cross-dialect-readiness';
export type { ObjectTypeReadiness, ReadinessLevel } from './modules/cross-dialect-readiness';
export { buildBrowseResult } from './modules/browse';
export {
  splitSqlStatements,
  checkStatement,
  isWriteStatement,
  firstKeyword,
  extractTableAliases,
  statementVerb,
  isMutatingDmlStatement,
  dmlLacksWhere,
  parseCodeCell,
  findCodeFences,
  stripJsStringsAndComments,
  stripCodeFenceMarkers,
  codeCellHasReturn,
  stripFullLineSqlComments,
  isCodeCellKind,
  isNodeCodeCellKind,
  codeCellNeedsTs,
  nodeCodeCellWireKind,
} from './modules/sql-splitter';
export type {
  SplitStatement,
  StatementStatus,
  StatementKind,
  CodeCellKind,
  BrowserCodeCellKind,
  NodeCodeCellKind,
  TsCodeCellKind,
  CodeFenceRange,
} from './modules/sql-splitter';
export {
  parseFoxScript,
  compileFoxScriptPlan,
  foxScriptExecutableTexts,
} from './modules/foxscript-ast';
export type {
  FoxScriptBlock,
  FoxScriptCodeBlock,
  FoxScriptSqlBlock,
  FoxScriptDocument,
  FoxScriptDiagnostic,
  FoxScriptExecutionPlan,
  FoxScriptPlanStep,
  FoxScriptRange,
  FoxScriptBlockKind,
} from './modules/foxscript-ast';
export type {
  CodeCellLast,
  CodeCellVars,
  CodeCellOk,
  CodeCellErr,
  CodeCellResult,
} from './modules/code-cell-types';
export { isCodeCellLast, isCodeCellVars, CODE_CELL_KIND_LABEL } from './modules/code-cell-types';
export type { SqlDialect, CanonicalType, CanonicalBase, RenderedType } from './modules/sql-dialect.interface';
export { resolveDialect, DIALECT_MAP } from './modules/dialect-registry';
export {
  sqlTag,
  renderSqlQuery,
  isSqlQuery,
  makeSqlQuery,
  placeholderStyleFor,
  renderPlaceholder,
  quoteSqlIdentifier,
} from './modules/sql-template';
export type { SqlQuery, SqlTag, RenderedSql, SqlPlaceholderStyle } from './modules/sql-template';
export {
  CODE_CELL_ALLOWED_PACKAGES,
  parseCodeCellImports,
  resolveCodeCellImportBindings,
  prepareCodeCellImports,
  normalizeCodeCellReturn,
  cloneCodeCellLast,
  runCodeCellBody,
} from './modules/code-cell-exec';
export type {
  CodeCellAllowedPackage,
  CodeCellImportSpec,
  RunCodeCellBodyArgs,
} from './modules/code-cell-exec';

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
export {
  BoundedPoolCache,
  disposePoolEndOrClose,
  nonSecretFingerprint,
  credentialedCacheKey,
} from './cores/pool-cache';
export { setupDb2ClientEnv } from './providers/db2/db2.env';
export {
  resolveFkReferencedColumns,
  normalizeForeignKeyInfo,
  normalizeTableSchemas,
  dbSchemaToTableSchemas,
  rolesToTableSchemas,
  groupRoleRows,
  roleSkippedWarning,
} from './cores/schema-to-tables';

// Provider/adapter registries
export { getAdapter, ADAPTERS } from './providers/adapter-registry';
export { getRegisteredProvider, PROVIDERS } from './providers/provider-registry';
