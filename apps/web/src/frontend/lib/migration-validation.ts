// Re-export from core — single source of truth for pre-flight migration validation.
export { findMissingFkTargets, findNarrowingTypeChanges, extractReviewNotices, validateMigrationPlan, resolveDialect } from '@foxschema/sql';
export type { ValidationIssue, ValidationSeverity, ValidationCode } from '@foxschema/sql';
