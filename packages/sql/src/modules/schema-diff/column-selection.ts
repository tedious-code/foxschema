/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which columns and triggers a migration may leave out, and which it may not.
 *
 * Deploy selection already worked at two levels: whole objects, and — inside a
 * role — individual members. This adds the level in between that people
 * actually ask for: "migrate this table, but not that column."
 *
 * The whole of the difficulty is that columns are not independent. A primary
 * key names its columns; so does an index, and so does a foreign key. Dropping
 * a column from a CREATE TABLE while an index in the same script still names it
 * produces a script that fails partway — after some statements have already
 * run. That is worse than refusing, because the schema is then in neither the
 * old shape nor the new one.
 *
 * So exclusion is allowed by default and blocked only where the script would
 * become invalid, with the reason attached so the UI can say why the box will
 * not untick rather than just disabling it.
 *
 * Only ADDED columns can break anything. Excluding a REMOVED column means "keep
 * it", and excluding a MODIFIED one means "leave its type alone" — both leave a
 * column that still exists for the key or index to name.
 */
import type { ColumnDiff, ForeignKeyDiff, IndexDiff, TableDiff } from '../../interfaces/diff.types.interface.js';

/**
 * Whether this object migrates column by column at all.
 *
 * Only an existing table does. A table being created renders its columns,
 * indexes, keys and triggers from `sourceTable` as one CREATE; a view or
 * routine is emitted from its stored definition as one body. In both cases
 * there is no per-column statement to include or leave out, so a checkbox there
 * could only ever be a lie — and every edge case this module accumulated lived
 * in the attempt to make one work anyway.
 *
 * Roles are excluded too: their "columns" are members, with their own selection.
 */
export function supportsColumnSelection(diff: TableDiff): boolean {
  return diff.objectType === 'TABLE' && diff.status !== 'ADDED';
}

/** Why a column cannot be left out, or null when it can. */
export interface ExclusionBlock {
  reason: string;
}

/**
 * Compare keys are uppercased; the column lists inside indexes and foreign keys
 * come from the catalogs in native casing. Matching them raw silently fails on
 * every engine that does not store identifiers in caps, and the failure is a
 * migration that names a column it did not create.
 */
const key = (name: string): string => name.trim().toUpperCase();

function columnsOf(entry: { source?: { columns: string[] }; target?: { columns: string[] } }): string[] {
  return [...(entry.source?.columns ?? []), ...(entry.target?.columns ?? [])];
}

/**
 * A referenced-table name as it appears inside a foreign key, reduced to the
 * compare key. Catalogs give it in native casing and sometimes schema-qualified
 * (`sales.orders`), while `tableName` is the bare uppercased match key.
 */
function referencedKey(name: string): string {
  const bare = name.split('.').pop() ?? name;
  return key(bare);
}

/** Does this index/FK still take part in the migration? */
function isEmitted(status: IndexDiff['status'] | ForeignKeyDiff['status']): boolean {
  return status !== 'UNCHANGED';
}

/**
 * Whether one column may be dropped from the migration.
 *
 * `includedIndexes` is the set of index compare-keys the reader opted into.
 * Indexes are opt-in, so one that was never ticked emits nothing and cannot be
 * broken by removing a column.
 *
 * Omitting the argument and passing an empty set mean different things, and
 * conflating them is a bug in both directions. `undefined` is "this caller does
 * not track opt-ins", so every emitted index counts and more columns are
 * blocked. An empty set is "the reader opted into none", so no index blocks
 * anything. Treating empty as unknown left a column pinned by an index that was
 * not in the script.
 */
export interface ExclusionContext {
  /**
   * Index compare-keys the reader opted into. Omitting this and passing an
   * empty set mean different things — see the note above.
   */
  includedIndexes?: ReadonlySet<string>;
  /**
   * The other tables in the migration. A foreign key lives on the child table
   * but names columns on the parent, so a parent's column can only be shown as
   * pinned by looking at everyone else's keys. Omit when the caller has no
   * wider view; cross-table pinning is then simply not applied.
   */
  siblings?: readonly TableDiff[];
}

export function columnExclusionBlock(
  diff: TableDiff,
  columnName: string,
  ctx: ExclusionContext = {}
): ExclusionBlock | null {
  const { includedIndexes, siblings } = ctx;
  const col = diff.columnDiffs.find((c) => key(c.name) === key(columnName));
  if (!col) return null;

  // Leaving out a drop or a type change still leaves the column in place, so
  // nothing that names it can break.
  if (col.status !== 'ADDED') return null;

  const k = key(columnName);

  if (col.source?.primaryKey || col.target?.primaryKey) {
    return {
      reason:
        'Part of the primary key. A table cannot be created without the columns its key names.',
    };
  }

  for (const idx of diff.indexDiffs ?? []) {
    if (!isEmitted(idx.status)) continue;
    // An index nobody ticked is not in the script, so it cannot be broken.
    if (includedIndexes && !includedIndexes.has(key(idx.name))) continue;
    if (columnsOf(idx).some((c) => key(c) === k)) {
      return {
        reason: `Indexed by ${idx.source?.name ?? idx.target?.name ?? idx.name}. Leave the index out too, or keep this column.`,
      };
    }
  }

  for (const fk of diff.foreignKeyDiffs ?? []) {
    if (!isEmitted(fk.status)) continue;
    if (columnsOf(fk).some((c) => key(c) === k)) {
      return {
        reason: `Used by foreign key ${fk.name}. Leave the key out too, or keep this column.`,
      };
    }
  }

  // A foreign key sits on the child table and names columns on the parent, so
  // the parent's own diff says nothing about it. Without this, dropping a
  // parent column left the child's ADD CONSTRAINT naming a column the script
  // never created — and that statement runs after the table is already there.
  const thisTable = key(diff.tableName);
  for (const other of siblings ?? []) {
    if (key(other.tableName) === thisTable) continue;
    for (const fk of other.foreignKeyDiffs ?? []) {
      if (!isEmitted(fk.status)) continue;
      const refs = [fk.source, fk.target].filter(Boolean) as {
        referencedTable: string;
        referencedColumns: string[];
      }[];
      for (const ref of refs) {
        if (referencedKey(ref.referencedTable) !== thisTable) continue;
        if ((ref.referencedColumns ?? []).some((c) => key(c) === k)) {
          return {
            reason: `Referenced by ${other.tableName}'s foreign key ${fk.name}. Leave that key out too, or keep this column.`,
          };
        }
      }
    }
  }

  return null;
}

/** Every column on this table that cannot be left out, keyed by compare key. */
export function blockedColumns(
  diff: TableDiff,
  ctx: ExclusionContext = {}
): Map<string, ExclusionBlock> {
  const out = new Map<string, ExclusionBlock>();
  for (const col of diff.columnDiffs) {
    const block = columnExclusionBlock(diff, col.name, ctx);
    if (block) out.set(key(col.name), block);
  }
  return out;
}

/**
 * Apply a column opt-out to one table's diffs.
 *
 * Opt-out, so an absent entry means "migrate it" — a table nobody has touched
 * behaves exactly as it did before this feature existed. A column the rules
 * refuse to drop is kept whatever the selection says: the selection is a
 * request, and this is the last place that can stop an invalid script.
 */
export function applyColumnSelection(
  diff: TableDiff,
  selection: Record<string, boolean> | undefined,
  ctx: ExclusionContext = {}
): ColumnDiff[] {
  if (!selection || !supportsColumnSelection(diff)) return diff.columnDiffs;
  const blocked = blockedColumns(diff, ctx);
  return diff.columnDiffs.filter((c) => {
    if (selection[c.name] !== false) return true;
    // Unchanged columns carry no statement, so excluding one is meaningless;
    // dropping them from the list would also hide them from CREATE TABLE.
    if (c.status === 'UNCHANGED') return true;
    return blocked.has(key(c.name));
  });
}

/** Apply a trigger opt-out. Triggers depend on nothing else in the script. */
export function applyTriggerSelection(
  diff: TableDiff,
  selection: Record<string, boolean> | undefined
): NonNullable<TableDiff['triggerDiffs']> {
  const triggers = diff.triggerDiffs ?? [];
  // A created table emits its triggers from `sourceTable.triggers`, not from
  // these diffs, so filtering here would change nothing while the checkbox
  // claimed otherwise.
  if (!selection || !supportsColumnSelection(diff)) return triggers;
  return triggers.filter((t) => selection[t.name] !== false || t.status === 'UNCHANGED');
}

/**
 * Apply both opt-outs to a whole table diff.
 *
 * Both are no-ops on an object that does not migrate column by column — see
 * `supportsColumnSelection`. That check lives here as well as in the UI because
 * a selection can outlive the compare that produced it: tick a column on a
 * modified table, re-compare, and the same table can come back as a create.
 */
export function applySelectionToDiff(
  diff: TableDiff,
  opts: {
    columnSelection?: Record<string, boolean>;
    triggerSelection?: Record<string, boolean>;
  } & ExclusionContext
): TableDiff {
  return {
    ...diff,
    columnDiffs: applyColumnSelection(diff, opts.columnSelection, opts),
    triggerDiffs: applyTriggerSelection(diff, opts.triggerSelection),
  };
}
