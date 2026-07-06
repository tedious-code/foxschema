/**
 * Shared diff-display constants used by both the line `fox compare` output
 * (commands/compare.ts) and the TUI's compare screens (tui/components/,
 * tui/screens/CompareScreen.tsx) — kept in one place so the two views can't
 * silently drift apart on labels or ordering.
 */
import type { ColumnDiff, ForeignKeyDiff, IndexDiff, TriggerDiff } from '@foxschema/core';

// Object-type → plural section label (matches the DbObjectType union in core).
export const TYPE_LABEL: Record<string, string> = {
  TABLE: 'TABLES',
  VIEW: 'VIEWS',
  MQT: 'MATERIALIZED VIEWS',
  SEQUENCE: 'SEQUENCES',
  TYPE: 'TYPES',
  FUNCTION: 'FUNCTIONS',
  PROCEDURE: 'PROCEDURES',
  TRIGGER: 'TRIGGERS',
  ROLE: 'ROLES',
};

// Canonical section order, used to break ties when two types have the same count.
export const TYPE_ORDER = Object.keys(TYPE_LABEL);

// The order changes are listed within a type's section.
export const STATUS_ORDER: Record<string, number> = { MODIFIED: 0, ADDED: 1, REMOVED: 2 };

/** Sort object-type sections by count desc, ties broken by TYPE_ORDER. */
export function sortSections<T>(entries: [string, T[]][]): [string, T[]][] {
  return [...entries].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]);
  });
}

/** Sort items within a section by status (modified, added, removed), then name. */
export function sortByStatusThenName<T extends { status: string; tableName: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.tableName.localeCompare(b.tableName)
  );
}

/** Group a flat diff list by objectType. */
export function groupByType<T extends { objectType: string }>(items: T[]): Map<string, T[]> {
  const byType = new Map<string, T[]>();
  for (const t of items) {
    const list = byType.get(t.objectType) ?? [];
    list.push(t);
    byType.set(t.objectType, list);
  }
  return byType;
}

/** Count items in a diff list by status (ADDED/MODIFIED/REMOVED/UNCHANGED). */
export function countByStatus<T extends { status: string }>(items: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

// One-line human descriptions of a column/index/FK/trigger diff — used by both
// the line CLI's tree view (commands/compare.ts) and the TUI's drill-down
// screen (tui/screens/TableDiffDetailScreen.tsx).

export function describeColumn(c: ColumnDiff): string {
  const oldType = c.source?.type;
  const newType = c.target?.type;
  if (c.status === 'MODIFIED' && oldType && newType && oldType !== newType) return `${oldType} → ${newType}`;
  const type = newType ?? oldType ?? '';
  const nullable = (c.status === 'REMOVED' ? c.source : c.target)?.nullable;
  return `${type}${nullable === false ? ' NOT NULL' : ''}`;
}

export function describeIndex(i: IndexDiff): string {
  const side = i.target ?? i.source;
  return side ? `(${side.columns.join(', ')})${side.unique ? ' UNIQUE' : ''}` : '';
}

export function describeFk(f: ForeignKeyDiff): string {
  const side = f.target ?? f.source;
  return side ? `(${side.columns.join(', ')}) → ${side.referencedTable}(${side.referencedColumns.join(', ')})` : '';
}

export function describeTrigger(t: TriggerDiff): string {
  const side = t.target ?? t.source;
  return side ? `${side.timing ?? ''} ${side.event ?? ''}`.trim() : '';
}
