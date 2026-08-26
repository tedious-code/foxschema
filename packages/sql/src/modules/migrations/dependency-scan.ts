import type { TableDiff, DbObjectType } from '../../interfaces/index.js';

/**
 * A procedural object (view/function/procedure/trigger) in the TARGET database
 * whose body references something the migration is about to drop. Dropping the
 * table or column would invalidate this dependent, so the UI warns before deploy.
 */
export interface DropDependency {
  /** The dependent object that references the dropped table/column. */
  dependentName: string;
  dependentType: DbObjectType;
  /** What's being dropped: a bare table name, or "TABLE.COLUMN" for a column. */
  dropped: string;
  kind: 'table' | 'column';
  /**
   * True when the dependent is itself a changed (MODIFIED) object in the diff, so
   * including it in the deploy recreates it from the source definition — which no
   * longer references the dropped column/table. Lets the UI offer a one-click fix.
   */
  deployable: boolean;
}

export interface DropDependencyOptions {
  /** Additive mode drops nothing, so there's nothing to warn about. */
  nonDestructive?: boolean;
}

const PROCEDURAL_TYPES: ReadonlySet<DbObjectType> = new Set(['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER']);

/** Drops any leading "schema." prefix and surrounding quotes from an object name. */
function bareName(name: string): string {
  return name.replace(/^"?[^".]+"?\./, '').replace(/"/g, '');
}

/**
 * Normalize a procedural body for matching — identical to compare.module's
 * normalizeDefinition: collapse whitespace, lowercase, strip schema qualifiers
 * from CREATE statements and from FROM/JOIN/etc. table references in the body.
 */
function normalize(d: string | undefined | null): string {
  if (!d) return '';
  return d
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b(function|procedure|view|trigger|table)\s+"?[\w$]+"?\s*\.\s*"?/g, '$1 ')
    .replace(/\b(from|join|update|into|table)\s+"?[\w$]+"?\s*\.\s*"?/g, '$1 ');
}

/** Tokenize a normalized body once into an identifier set for O(1) membership. */
export function tokenizeSqlIdents(normalizedBody: string): Set<string> {
  const tokens = new Set<string>();
  const re = /[a-z_][a-z0-9_$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizedBody)) !== null) {
    tokens.add(m[0]);
  }
  return tokens;
}

/** Whether a tokenized body references `ident` as a whole identifier. */
function referencesTokens(tokens: Set<string>, ident: string): boolean {
  return tokens.has(ident.toLowerCase());
}

/** The target-side body of a procedural object (what actually exists in the target DB). */
function targetBody(t: TableDiff): string {
  return t.targetTable?.definition ?? t.definition ?? '';
}

/**
 * Scan the selected destructive changes for views/functions/procedures/triggers
 * in the target that would break. Pure, client-side text heuristic — no DB query.
 * May over- or under-report (e.g. `SELECT *` views don't name their columns), so
 * the UI presents results as a recommendation, not a hard block.
 */
export function findDropDependencies(
  tables: TableDiff[],
  selection: Record<string, boolean>,
  options: DropDependencyOptions = {}
): DropDependency[] {
  if (options.nonDestructive) return [];

  // 1. Collect what the selected diffs will drop.
  const droppedTables: string[] = [];
  const droppedColumns: Array<{ table: string; column: string }> = [];

  for (const t of tables) {
    if (!selection[t.tableName]) continue;
    const isTable = t.objectType === 'TABLE' || t.objectType === 'MQT';
    if (isTable && t.status === 'REMOVED') {
      droppedTables.push(bareName(t.tableName));
    } else if (isTable && t.status === 'MODIFIED') {
      // Column drops only matter when the table itself survives — a dropped table
      // is already covered by droppedTables above.
      for (const c of t.columnDiffs) {
        if (c.status === 'REMOVED') droppedColumns.push({ table: bareName(t.tableName), column: c.name });
      }
    }
  }

  if (droppedTables.length === 0 && droppedColumns.length === 0) return [];

  // 2. Candidate dependents: procedural objects that exist in the target (not
  //    source-only ADDED, and not ones being dropped themselves).
  const deps: DropDependency[] = [];
  const seen = new Set<string>();

  for (const cand of tables) {
    if (!PROCEDURAL_TYPES.has(cand.objectType)) continue;
    if (cand.status === 'ADDED') continue; // source-only — doesn't exist in target yet
    if (cand.status === 'REMOVED' && selection[cand.tableName]) continue; // being dropped anyway

    const body = normalize(targetBody(cand));
    if (!body) continue;
    // Tokenize once per body — avoid N regex scans over the full string.
    const tokens = tokenizeSqlIdents(body);
    const deployable = cand.status === 'MODIFIED';

    const record = (dropped: string, kind: 'table' | 'column') => {
      const dedupe = `${cand.tableName}${dropped}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      deps.push({ dependentName: bareName(cand.tableName), dependentType: cand.objectType, dropped, kind, deployable });
    };

    for (const tbl of droppedTables) {
      if (referencesTokens(tokens, tbl)) record(tbl, 'table');
    }
    for (const { table, column } of droppedColumns) {
      // Require both the table and the column — a bare column-name match alone is
      // too noisy (common names like id/name/status collide across tables).
      if (referencesTokens(tokens, table) && referencesTokens(tokens, column)) {
        record(`${table}.${column}`, 'column');
      }
    }
  }

  return deps;
}
