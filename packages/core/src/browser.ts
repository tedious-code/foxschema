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
export { dialectSupportsFk } from './modules/dialect-fk-support';
export type { FkFeatureSupport } from './modules/dialect-fk-support';
export { dialectSupportsIndex } from './modules/dialect-index-support';
export type { IndexFeatureSupport } from './modules/dialect-index-support';
export {
  dialectSupportsIndexFragmentation,
  buildIndexFragmentationQuery,
  buildIndexFragmentationCustomTemplate,
  buildIndexDefragSql,
  normalizeIndexFragmentationRows,
  fragmentationSeverity,
  splitSchemaTable,
  isSafeIndexFragmentationCustomSql,
} from './modules/dialect-index-fragmentation';
export type {
  IndexFragmentationSupport,
  IndexFragmentationQuery,
  IndexFragmentationRow,
  IndexFragmentationMode,
  IndexFragmentationSeverity,
} from './modules/dialect-index-fragmentation';
export {
  dialectSupportsDbaUtility,
  buildDbaUtilityQuery,
  normalizeConnectionPoolRows,
  normalizeUserSessionRows,
  normalizeSystemInfoRows,
  normalizeObjectSizeRows,
  formatBytes,
} from './modules/dialect-dba-utilities';
export type {
  DbaProbeMode,
  DbaUtilityKind,
  DbaUtilitySupport,
  DbaUtilityQuery,
  ConnectionPoolInfo,
  UserSessionRow,
  SystemInfoMetric,
  ObjectSizeRow,
} from './modules/dialect-dba-utilities';
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

export { buildConnectionString, withConnectionString, DEFAULT_PORTS } from './cores/connection-string';
export { PROVIDER_SETTINGS, getProviderSettings } from './providers/provider-settings';
export {
  resolveFkReferencedColumns,
  normalizeForeignKeyInfo,
  normalizeTableSchemas,
} from './cores/schema-to-tables';
