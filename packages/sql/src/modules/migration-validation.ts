import type { TableDiff, DbObjectType } from '../interfaces';
import type { SqlDialect, CanonicalType } from './sql-dialect.interface';
import type { MigrationStep } from './sql-generator.module';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode = 'MISSING_FK_TARGET' | 'NARROWING_TYPE_CHANGE' | 'REVIEW_REQUIRED';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  /** Compare-key name of the table this issue is about — ties back to the diff row. */
  tableName: string;
  message: string;
}

const TABLE_LIKE: ReadonlySet<DbObjectType> = new Set(['TABLE', 'MQT']);

/** Drops any leading "schema." prefix and surrounding quotes, then uppercases for matching. */
function key(name: string): string {
  return name.replace(/^"?[^".]+"?\./, '').replace(/"/g, '').toUpperCase();
}

/** Same normalization, kept lowercase-preserving for display. */
function bareName(name: string): string {
  return name.replace(/^"?[^".]+"?\./, '').replace(/"/g, '');
}

/**
 * FK diffs (ADDED/MODIFIED) whose referenced table won't actually exist in the
 * target once this migration runs — e.g. the parent table was renamed or its
 * own drop is selected while a child FK pointing at it is still selected.
 * Pure text/data check — no DB round-trip.
 */
export function findMissingFkTargets(tables: TableDiff[], selection: Record<string, boolean>): ValidationIssue[] {
  const willExist = new Set<string>();
  for (const t of tables) {
    if (!TABLE_LIKE.has(t.objectType)) continue;
    const selected = !!selection[t.tableName];
    const survives =
      t.status === 'UNCHANGED' ||
      t.status === 'MODIFIED' ||
      (t.status === 'ADDED' && selected) ||
      (t.status === 'REMOVED' && !selected);
    if (survives) willExist.add(key(t.tableName));
  }

  const issues: ValidationIssue[] = [];
  for (const t of tables) {
    if (!selection[t.tableName]) continue;
    for (const fk of t.foreignKeyDiffs) {
      if (fk.status !== 'ADDED' && fk.status !== 'MODIFIED') continue;
      const ref = fk.source?.referencedTable;
      if (!ref) continue;
      if (!willExist.has(key(ref))) {
        issues.push({
          severity: 'error',
          code: 'MISSING_FK_TARGET',
          tableName: t.tableName,
          message: `Foreign key ${fk.name} on ${bareName(t.tableName)} references ${bareName(ref)}, which won't exist in the target after this migration.`,
        });
      }
    }
  }
  return issues;
}

/** Ranks within a numeric family — lower rank narrows to a higher one. */
const INT_RANK: Record<string, number> = { smallint: 1, integer: 2, bigint: 3 };
const FLOAT_RANK: Record<string, number> = { real: 1, double: 2 };

function isNarrowing(source: CanonicalType, target: CanonicalType): boolean {
  if (source.base === target.base) {
    if (source.length !== undefined && target.length !== undefined && target.length < source.length) return true;
    if (source.base === 'decimal') {
      if (source.precision !== undefined && target.precision !== undefined && target.precision < source.precision) return true;
      if (source.scale !== undefined && target.scale !== undefined && target.scale < source.scale) return true;
    }
    return false;
  }
  if (source.base in INT_RANK && target.base in INT_RANK) return INT_RANK[target.base] < INT_RANK[source.base];
  if (source.base in FLOAT_RANK && target.base in FLOAT_RANK) return FLOAT_RANK[target.base] < FLOAT_RANK[source.base];
  // Unbounded text going to a bounded string type is a narrowing regardless of length.
  if (source.base === 'text' && (target.base === 'varchar' || target.base === 'char')) return true;
  return false;
}

/**
 * MODIFIED columns whose new type is a narrowing of the old one (shorter length,
 * reduced decimal precision/scale, or a smaller numeric family member) — data-loss
 * risk that the generic "destructive drop" check can't see, since no DROP is involved.
 */
export function findNarrowingTypeChanges(
  tables: TableDiff[],
  selection: Record<string, boolean>,
  dialect: SqlDialect
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const t of tables) {
    if (!selection[t.tableName] || t.status !== 'MODIFIED' || !TABLE_LIKE.has(t.objectType)) continue;
    for (const c of t.columnDiffs) {
      if (c.status !== 'MODIFIED' || !c.source || !c.target) continue;
      // c.source is the desired end state (what the target column becomes); c.target
      // is the target DB's current column, i.e. the value being replaced.
      const currentType = dialect.parseType(c.target.type);
      const desiredType = dialect.parseType(c.source.type);
      if (isNarrowing(currentType, desiredType)) {
        issues.push({
          severity: 'warning',
          code: 'NARROWING_TYPE_CHANGE',
          tableName: t.tableName,
          message: `Column ${c.name} on ${bareName(t.tableName)} narrows from ${c.target.type} to ${c.source.type} — may truncate or reject existing data.`,
        });
      }
    }
  }
  return issues;
}

const REVIEW_LINE = /^--\s*review:\s*(.+)$/i;
const MANUAL_REVIEW_LINE = /^--\s*MANUAL REVIEW REQUIRED:\s*(.+)$/i;

/**
 * Surface the "-- review:" and "-- MANUAL REVIEW REQUIRED:" comments the generator
 * already embeds in migration steps (cross-dialect type translation warnings,
 * untranslated procedural bodies) as structured issues, so they're visible before
 * Execute instead of only inside the scrolled SQL preview.
 */
export function extractReviewNotices(steps: MigrationStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const step of steps) {
    for (const stmt of step.statements) {
      const trimmed = stmt.trim();
      const manual = trimmed.match(MANUAL_REVIEW_LINE);
      const review = trimmed.match(REVIEW_LINE);
      const detail = manual?.[1] ?? review?.[1];
      if (!detail) continue;
      issues.push({ severity: 'warning', code: 'REVIEW_REQUIRED', tableName: step.objectName, message: detail });
    }
  }
  return issues;
}

/** Runs all pre-flight checks, errors first. */
export function validateMigrationPlan(
  tables: TableDiff[],
  selection: Record<string, boolean>,
  dialect: SqlDialect,
  steps: MigrationStep[]
): ValidationIssue[] {
  return [
    ...findMissingFkTargets(tables, selection),
    ...findNarrowingTypeChanges(tables, selection, dialect),
    ...extractReviewNotices(steps),
  ];
}
