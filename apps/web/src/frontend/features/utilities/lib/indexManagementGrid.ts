/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sort + summary helpers for Utilities → Index Management.
 */

export type IndexMgmtSortKey =
  | 'name'
  | 'columns'
  | 'type'
  | 'indexes'
  | 'rows'
  | 'data'
  | 'indexSize'
  | 'frag'
  | 'lastUsed';

export type SortDir = 'asc' | 'desc';

export interface IndexMgmtSort {
  key: IndexMgmtSortKey;
  dir: SortDir;
}

export const DEFAULT_INDEX_MGMT_SORT: IndexMgmtSort = { key: 'name', dir: 'asc' };

/** Mean of known fragmentation percents; null when none of the indexes reported %. */
export function averageFragmentation(
  pcts: ReadonlyArray<number | null | undefined>
): number | null {
  const nums = pcts.filter((n): n is number => n != null && Number.isFinite(n));
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function compareSortable(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDir
): number {
  const mul = dir === 'asc' ? 1 : -1;
  const aMissing =
    a == null || a === '' || (typeof a === 'number' && !Number.isFinite(a));
  const bMissing =
    b == null || b === '' || (typeof b === 'number' && !Number.isFinite(b));
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * mul;
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base' }) * mul;
}

/** Click the same column to flip direction; a new column starts ascending. */
export function nextIndexMgmtSort(
  current: IndexMgmtSort,
  clicked: IndexMgmtSortKey
): IndexMgmtSort {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clicked, dir: 'asc' };
}

export interface SortableIndexGroup<R> {
  tableName: string;
  rows: R[];
}

/**
 * Sort table groups by a table-level value, and indexes inside each group by
 * an index-level value. Missing values sort last. Table name / index identity
 * is the tiebreaker so the grid stays stable.
 */
export function sortGroupedIndexes<G extends { tableName: string; rows: readonly unknown[] }>(
  groups: G[],
  sort: IndexMgmtSort,
  tableValue: (group: G) => string | number | null | undefined,
  indexValue: (row: G['rows'][number], group: G) => string | number | null | undefined,
  indexName: (row: G['rows'][number]) => string
): G[] {
  return groups
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => {
        const cmp = compareSortable(indexValue(a, group), indexValue(b, group), sort.dir);
        if (cmp !== 0) return cmp;
        return compareSortable(indexName(a), indexName(b), 'asc');
      }) as G['rows'],
    }))
    .sort((a, b) => {
      const cmp = compareSortable(tableValue(a), tableValue(b), sort.dir);
      if (cmp !== 0) return cmp;
      return compareSortable(a.tableName, b.tableName, 'asc');
    });
}

export function tableSortValue(
  key: IndexMgmtSortKey,
  group: {
    tableName: string;
    indexCount: number;
    avgFrag: number | null;
    rowCount: number | null;
    dataBytes: number | null;
    indexBytes: number | null;
    lastUsedMs?: number | null;
  }
): string | number | null {
  switch (key) {
    case 'name':
      return group.tableName;
    case 'columns':
      return null;
    case 'type':
      return 'table';
    case 'indexes':
      return group.indexCount;
    case 'rows':
      return group.rowCount;
    case 'data':
      return group.dataBytes;
    case 'indexSize':
      return group.indexBytes;
    case 'frag':
      return group.avgFrag;
    case 'lastUsed':
      return group.lastUsedMs ?? null;
    default:
      return group.tableName;
  }
}

export function indexSortValue(
  key: IndexMgmtSortKey,
  row: {
    indexName: string;
    columns: string;
    type: string;
    rowCount: number | null;
    dataBytes: number | null;
    indexBytes: number | null;
    fragPct: number | null;
    lastUsed?: string | null;
    scanCount?: number | null;
  }
): string | number | null {
  switch (key) {
    case 'name':
      return row.indexName;
    case 'columns':
      return row.columns;
    case 'type':
      return row.type;
    case 'indexes':
      return null;
    case 'rows':
      return row.rowCount;
    case 'data':
      return row.dataBytes;
    case 'indexSize':
      return row.indexBytes;
    case 'frag':
      return row.fragPct;
    case 'lastUsed':
      return lastUsedSortValue(row.lastUsed, row.scanCount);
    default:
      return row.indexName;
  }
}

/** Milliseconds since epoch, or scan count when no timestamp is available. */
export function lastUsedSortValue(
  lastUsed: string | null | undefined,
  scanCount?: number | null
): number | null {
  if (lastUsed) {
    const ms = Date.parse(lastUsed);
    if (Number.isFinite(ms) && new Date(ms).getUTCFullYear() >= 1971) return ms;
  }
  if (scanCount != null && Number.isFinite(scanCount)) return scanCount;
  return null;
}

export function latestLastUsedSortValue(
  items: ReadonlyArray<{ lastUsed?: string | null; scanCount?: number | null }>
): number | null {
  let best: number | null = null;
  for (const item of items) {
    const v = lastUsedSortValue(item.lastUsed, item.scanCount);
    if (v == null) continue;
    if (best == null || v > best) best = v;
  }
  return best;
}

export function pickLatestIndexUsage(
  items: ReadonlyArray<{ lastUsed?: string | null; scanCount?: number | null }>
): { lastUsed: string | null; scanCount: number | null } {
  let bestLast: string | null = null;
  let bestLastMs = -1;
  let bestScan: number | null = null;
  for (const item of items) {
    const ms = lastUsedSortValue(item.lastUsed, null);
    if (ms != null && ms > bestLastMs) {
      bestLastMs = ms;
      bestLast = item.lastUsed ?? null;
    }
    if (item.scanCount != null && Number.isFinite(item.scanCount)) {
      if (bestScan == null || item.scanCount > bestScan) bestScan = item.scanCount;
    }
  }
  return { lastUsed: bestLast, scanCount: bestScan };
}

/** Compact grid label: timestamp, else scan count / never / em dash. */
export function formatIndexLastUsed(opts: {
  lastUsed?: string | null;
  scanCount?: number | null;
}): string {
  const lastUsed = opts.lastUsed?.trim() || null;
  if (lastUsed) {
    const ms = Date.parse(lastUsed);
    if (Number.isFinite(ms) && new Date(ms).getUTCFullYear() >= 1971) {
      return new Date(ms).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
  const scans = opts.scanCount;
  if (scans === 0) return 'never';
  if (scans != null && Number.isFinite(scans)) {
    return `${scans.toLocaleString()} scans`;
  }
  return '—';
}
