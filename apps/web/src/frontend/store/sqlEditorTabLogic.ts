import { splitSqlStatements } from '../lib/sql-splitter';

export type ResultsLayout = 'byCredential' | 'sideBySide';

export interface SqlTab {
  id: string;
  title: string;
  sql: string;
  selectedConnectionIds: string[];
  /**
   * Indices into the current split of `sql`. Empty means "run the first
   * statement only" (agreed default). Not persisted.
   */
  checkedStatements: number[];
  layout: ResultsLayout;
  /** When set, renaming the tab also renames this bookmark (and vice versa). */
  bookmarkId?: string;
}

export function newTabId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTab(partial?: Partial<SqlTab>): SqlTab {
  return {
    id: partial?.id ?? newTabId(),
    title: partial?.title ?? 'Query 1',
    sql: partial?.sql ?? '',
    selectedConnectionIds: partial?.selectedConnectionIds ?? [],
    checkedStatements: partial?.checkedStatements ?? [],
    layout: partial?.layout ?? 'byCredential',
    bookmarkId: partial?.bookmarkId,
  };
}

/** Next title like Query 2, Query 3 — based on existing Query N titles. */
export function nextTabTitle(tabs: SqlTab[]): string {
  let max = 0;
  for (const t of tabs) {
    const m = /^Query\s+(\d+)$/i.exec(t.title.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Query ${max + 1}`;
}

export function addTab(tabs: SqlTab[]): { tabs: SqlTab[]; activeTabId: string } {
  const tab = createTab({ title: nextTabTitle(tabs) });
  return { tabs: [...tabs, tab], activeTabId: tab.id };
}

/**
 * Close a tab. Refuses to leave zero tabs (replaces the last with a fresh empty
 * one). Activates a neighbor when the closed tab was active.
 */
export function closeTab(
  tabs: SqlTab[],
  activeTabId: string,
  id: string
): { tabs: SqlTab[]; activeTabId: string } {
  if (tabs.length <= 1) {
    const alone = createTab({ title: 'Query 1' });
    return { tabs: [alone], activeTabId: alone.id };
  }
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return { tabs, activeTabId };
  const nextTabs = tabs.filter((t) => t.id !== id);
  if (activeTabId !== id) return { tabs: nextTabs, activeTabId };
  const neighbor = nextTabs[Math.min(idx, nextTabs.length - 1)]!;
  return { tabs: nextTabs, activeTabId: neighbor.id };
}

/**
 * When the statement count changes, clear checks so we don't keep stale
 * indices. Same count → keep checks, pruning any out-of-range index.
 */
export function checkedAfterSqlChange(
  prevSql: string,
  nextSql: string,
  prevChecked: number[]
): number[] {
  const prevCount = splitSqlStatements(prevSql).length;
  const nextCount = splitSqlStatements(nextSql).length;
  if (prevCount !== nextCount) return [];
  return prevChecked.filter((i) => i >= 0 && i < nextCount);
}

/**
 * Statements to send on Run. Empty check set → first statement only.
 * Checked indices are sorted and de-duplicated.
 */
export function statementsToRun(sql: string, checkedStatements: number[]): string[] {
  const all = splitSqlStatements(sql);
  if (all.length === 0) return [];
  if (checkedStatements.length === 0) return [all[0]!.text];
  const uniq = [...new Set(checkedStatements)]
    .filter((i) => i >= 0 && i < all.length)
    .sort((a, b) => a - b);
  if (uniq.length === 0) return [all[0]!.text];
  return uniq.map((i) => all[i]!.text);
}

export function toggleStatementCheck(checked: number[], index: number): number[] {
  return checked.includes(index) ? checked.filter((i) => i !== index) : [...checked, index].sort((a, b) => a - b);
}

/**
 * Destination servers for a tab: either the shared list (all queries) or this
 * tab's own selection.
 */
export function effectiveConnectionIds(
  tab: SqlTab,
  shareDestinations: boolean,
  sharedConnectionIds: string[]
): string[] {
  return shareDestinations ? sharedConnectionIds : tab.selectedConnectionIds;
}

/** Persistable tab slice (no checkedStatements / results). */
export function persistableTabs(tabs: SqlTab[]): Array<Omit<SqlTab, 'checkedStatements'>> {
  return tabs.map(({ id, title, sql, selectedConnectionIds, layout, bookmarkId }) => ({
    id,
    title,
    sql,
    selectedConnectionIds,
    layout,
    ...(bookmarkId ? { bookmarkId } : {}),
  }));
}

/** Rehydrate persisted tabs — restore empty checkedStatements. */
export function hydrateTabs(
  raw: Array<Partial<SqlTab> & Pick<SqlTab, 'id'>>
): SqlTab[] {
  if (!raw.length) return [createTab({ title: 'Query 1' })];
  return raw.map((t, i) =>
    createTab({
      id: t.id,
      title: t.title ?? `Query ${i + 1}`,
      sql: t.sql ?? '',
      selectedConnectionIds: Array.isArray(t.selectedConnectionIds) ? t.selectedConnectionIds : [],
      layout: t.layout === 'sideBySide' ? 'sideBySide' : 'byCredential',
      checkedStatements: [],
      bookmarkId: typeof t.bookmarkId === 'string' ? t.bookmarkId : undefined,
    })
  );
}
