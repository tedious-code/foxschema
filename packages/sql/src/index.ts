/**
 * @foxschema/sql — dialect knowledge, pure and runtime-neutral.
 *
 * SQL generation, schema compare, statement splitting, type mapping, and the
 * per-dialect definitions they read. No Node built-ins, no drivers, no I/O, and
 * no runtime dependencies, so this is safe to import from a browser bundle, a
 * worker, or an edge runtime.
 *
 * Executing any of it against a real database is @foxschema/db's job.
 */

export * from './interfaces/schema.interface.js';
export type {
  ConnectionOptions,
  SchemaProvider,
  RoleLoadResult,
  DriverInfo,
  SavedConnection,
  ProviderConnectionSettings,
  DriverAdapter,
} from './interfaces/schema-provider.interface.js';
export * from './interfaces/diff.types.interface.js';
export type { MigrationEvent } from './interfaces/migration.types.js';

export { CompareModule } from './modules/compare.module.js';
export { SqlGeneratorModule } from './modules/sql-generator.module.js';
export type { MigrationStep, SchemaMapping } from './modules/sql-generator.module.js';
export { findDropDependencies } from './modules/dependency-scan.js';
export type { DropDependency, DropDependencyOptions } from './modules/dependency-scan.js';
export { parseSqlSubset, subsetValue } from './modules/sql-subset.js';
export type {
  SubsetIntent,
  SubsetParse,
  SubsetValue,
  SubsetColumnEq,
} from './modules/sql-subset.js';
export { identityInsertSupport, identityInsertFor } from './modules/dialect-identity-insert.js';
// Lokee Weave — content-addressed schema versioning for Compare Schema.
export {
  applyChanges,
  canonicalizeObject,
  canonicalizeSchema,
  diffAgainstIndex,
  hashObject,
  hashObjects,
  rootHash,
  stableStringify,
  weave,
  classifyReversal,
  parseTypeText,
  planReversal,
  collapseObjectHistory,
  windowByTime,
  windowGraph,
  DEFAULT_WINDOW_ITEMS,
  MAX_WINDOW_ITEMS,
  databaseIdentity,
  databaseIdentityText,
  assembleBlueprint,
  blueprintChildCounts,
  countSourceLines,
  isLokeeContainerType,
  objectKeyKind,
  objectKeyOwner,
  pickOwnerContainer,
  hydrateTableSchemas,
  buildRevertMigration,
} from './modules/lokee-weave/index.js';
export type {
  CanonicalObject,
  ChangeOperation,
  Digest,
  LatestIndex,
  LokeeObjectType,
  ObjectChange,
  ReversalPlan,
  ReversalRisk,
  ReversalVerdict,
  WeaveCapture,
  WeaveObject,
  GraphNode,
  GraphResult,
  HistoryWindow,
  ObjectHistoryPoint,
  TimePoint,
  WindowResult,
  DatabaseIdentityInput,
  ObjectBlueprint,
  StoredWeaveObject,
  RevertMigration,
} from './modules/lokee-weave/index.js';
export type {
  IdentityInsertKind,
  IdentityInsertSupport,
} from './modules/dialect-identity-insert.js';
export { dialectSupportsFk } from './modules/dialect-fk-support.js';
export type { FkFeatureSupport } from './modules/dialect-fk-support.js';
export { dialectSupportsIndex } from './modules/dialect-index-support.js';
export type { IndexFeatureSupport } from './modules/dialect-index-support.js';
export {
  dialectSupportsIndexFragmentation,
  buildIndexFragmentationQuery,
  buildIndexFragmentationCustomTemplate,
  buildIndexDefragSql,
  normalizeIndexFragmentationRows,
  fragmentationSeverity,
  splitSchemaTable,
  isSafeIndexFragmentationCustomSql,
} from './modules/dialect-index-fragmentation.js';
export type {
  IndexFragmentationSupport,
  IndexFragmentationQuery,
  IndexFragmentationRow,
  IndexFragmentationMode,
  IndexFragmentationSeverity,
} from './modules/dialect-index-fragmentation.js';
export {
  dialectSupportsDbaUtility,
  buildDbaUtilityQuery,
  normalizeConnectionPoolRows,
  normalizeUserSessionRows,
  normalizeSystemInfoRows,
  normalizeObjectSizeRows,
  formatBytes,
} from './modules/dialect-dba-utilities.js';
export type {
  DbaProbeMode,
  DbaUtilityKind,
  DbaUtilitySupport,
  DbaUtilityQuery,
  ConnectionPoolInfo,
  UserSessionRow,
  SystemInfoMetric,
  ObjectSizeRow,
} from './modules/dialect-dba-utilities.js';
export { findMissingFkTargets, findNarrowingTypeChanges, extractReviewNotices, validateMigrationPlan } from './modules/migration-validation.js';
export type { ValidationIssue, ValidationSeverity, ValidationCode } from './modules/migration-validation.js';
export { CROSS_DIALECT_READINESS } from './modules/cross-dialect-readiness.js';
export type { ObjectTypeReadiness, ReadinessLevel } from './modules/cross-dialect-readiness.js';
export { buildBrowseResult } from './modules/browse.js';
export {
  splitSqlStatements,
  checkStatement,
  isWriteStatement,
  requiresWritePermission,
  sqlStatementCategory,
  sqlStatementCategories,
  firstKeyword,
  extractTableAliases,
  countReferencedTables,
  referencedTableNames,
  collectMultiTableWriteWarnings,
  statementVerb,
  isMutatingDmlStatement,
  isInsertWriteStatement,
  isPageableStatement,
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
} from './modules/sql-splitter.js';
export type {
  SplitStatement,
  StatementStatus,
  StatementKind,
  SqlStatementCategory,
  CodeCellKind,
  BrowserCodeCellKind,
  NodeCodeCellKind,
  TsCodeCellKind,
  CodeFenceRange,
  MultiTableWriteWarning,
} from './modules/sql-splitter.js';
export {
  parseFoxScript,
  compileFoxScriptPlan,
  foxScriptExecutableTexts,
} from './modules/foxscript-ast.js';
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
} from './modules/foxscript-ast.js';
export type {
  CodeCellLast,
  CodeCellVars,
  CodeCellOk,
  CodeCellErr,
  CodeCellResult,
} from './modules/code-cell-types.js';
export { isCodeCellLast, isCodeCellVars, CODE_CELL_KIND_LABEL } from './modules/code-cell-types.js';
export type { SqlDialect, CanonicalType, CanonicalBase, RenderedType } from './modules/sql-dialect.interface.js';
export { resolveDialect, DIALECT_MAP } from './modules/dialect-registry.js';
export {
  sqlTag,
  renderSqlQuery,
  isSqlQuery,
  makeSqlQuery,
  placeholderStyleFor,
  renderPlaceholder,
  quoteSqlIdentifier,
} from './modules/sql-template.js';
export type { SqlQuery, SqlTag, RenderedSql, SqlPlaceholderStyle } from './modules/sql-template.js';
export {
  CODE_CELL_ALLOWED_PACKAGES,
  parseCodeCellImports,
  resolveCodeCellImportBindings,
  prepareCodeCellImports,
  assertCodeCellSandboxSafe,
  neutralizeCodeCellHostBreakouts,
  normalizeCodeCellReturn,
  cloneCodeCellLast,
  runCodeCellBody,
} from './modules/code-cell-exec.js';
export type {
  CodeCellAllowedPackage,
  CodeCellImportSpec,
  RunCodeCellBodyArgs,
} from './modules/code-cell-exec.js';

export { buildConnectionString, withConnectionString, DEFAULT_PORTS } from './cores/connection-string.js';
export { PROVIDER_SETTINGS, getProviderSettings } from './providers/provider-settings.js';
// Row-shaping helpers. The providers in @foxschema/db call these to turn raw
// catalog rows into TableSchema; before the split they reached in by relative
// path, so only a few were listed here.
export {
  resolveFkReferencedColumns,
  normalizeForeignKeyInfo,
  normalizeTableSchemas,
  dbSchemaToTableSchemas,
  rolesToTableSchemas,
  groupRoleRows,
  roleSkippedWarning,
  groupForeignKeyRows,
} from './cores/schema-to-tables.js';
export type { FkRow } from './cores/schema-to-tables.js';
