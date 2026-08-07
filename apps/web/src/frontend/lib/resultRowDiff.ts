/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Key-based row classification for data migrate (source → destination).
 * Side-by-side cell tinting stays index-aligned; DML uses this classifier.
 */

import { resultValuesEqual } from './resultDataDiff';
import type { PeekKeyColumn } from './rowDml';

export const DATA_MIGRATE_ROW_CAP = 500;

export type RowDiffOp = 'insert' | 'update' | 'delete';

export interface ResultGridLike {
  columns: string[];
  rows: unknown[][];
}

export interface ClassifiedRowDiff {
  op: RowDiffOp;
  /** Composite key string for display / progress. */
  keyLabel: string;
  /** Source row (insert/update) — undefined for delete. */
  sourceRow?: unknown[];
  /** Destination row (update/delete) — undefined for insert. */
  destRow?: unknown[];
}

export interface RowDiffClassification {
  inserts: ClassifiedRowDiff[];
  updates: ClassifiedRowDiff[];
  deletes: ClassifiedRowDiff[];
  skippedNullKeys: number;
  /** Total ops before cap. */
  totalOps: number;
}

function colIndexMap(columns: string[]): Map<string, number> {
  const map = new Map<string, number>();
  columns.forEach((c, i) => {
    const k = c.toLowerCase();
    if (!map.has(k)) map.set(k, i);
  });
  return map;
}

/** Resolve key columns against a grid's column list. */
export function keyColumnsForGrid(
  keyNames: string[],
  columns: string[]
): PeekKeyColumn[] {
  const idx = colIndexMap(columns);
  return keyNames.map((name) => ({
    name,
    resultIndex: idx.get(name.toLowerCase()) ?? -1,
  }));
}

function rowKey(
  row: unknown[],
  keys: PeekKeyColumn[]
): { ok: true; key: string; label: string } | { ok: false } {
  const parts: string[] = [];
  const labels: string[] = [];
  for (const k of keys) {
    if (k.resultIndex < 0) return { ok: false };
    const v = row[k.resultIndex];
    if (v === null || v === undefined) return { ok: false };
    parts.push(`${k.name.toLowerCase()}=${String(v)}`);
    labels.push(`${k.name}=${String(v)}`);
  }
  return { ok: true, key: parts.join('|'), label: labels.join(', ') };
}

function nonKeyColumnsDiffer(
  sourceRow: unknown[],
  destRow: unknown[],
  sourceCols: string[],
  destCols: string[],
  keyNamesLower: Set<string>,
  ignoreLower: Set<string>
): boolean {
  const destIdx = colIndexMap(destCols);
  for (let i = 0; i < sourceCols.length; i++) {
    const name = sourceCols[i]!;
    const lower = name.toLowerCase();
    if (keyNamesLower.has(lower) || ignoreLower.has(lower)) continue;
    const di = destIdx.get(lower);
    if (di === undefined) continue;
    if (!resultValuesEqual(sourceRow[i], destRow[di])) return true;
  }
  return false;
}

/**
 * Classify rows for migrating **source → dest** by key columns.
 * - insert: key in source only
 * - update: key in both, non-key values differ
 * - delete: key in dest only
 *
 * `ignoreColumns` are excluded from update detection (trigger/audit fields).
 */
export function classifyRowsByKey(opts: {
  source: ResultGridLike;
  dest: ResultGridLike;
  keyNames: string[];
  ignoreColumns?: string[];
}): RowDiffClassification {
  const { source, dest, keyNames, ignoreColumns = [] } = opts;
  const sourceKeys = keyColumnsForGrid(keyNames, source.columns);
  const destKeys = keyColumnsForGrid(keyNames, dest.columns);
  const keyNamesLower = new Set(keyNames.map((k) => k.toLowerCase()));
  const ignoreLower = new Set(ignoreColumns.map((k) => k.toLowerCase()));

  if (
    sourceKeys.length === 0 ||
    sourceKeys.some((k) => k.resultIndex < 0) ||
    destKeys.some((k) => k.resultIndex < 0)
  ) {
    return {
      inserts: [],
      updates: [],
      deletes: [],
      skippedNullKeys: 0,
      totalOps: 0,
    };
  }

  const sourceMap = new Map<string, { row: unknown[]; label: string }>();
  const destMap = new Map<string, { row: unknown[]; label: string }>();
  let skippedNullKeys = 0;

  for (const row of source.rows) {
    const k = rowKey(row, sourceKeys);
    if (!k.ok) {
      skippedNullKeys += 1;
      continue;
    }
    if (!sourceMap.has(k.key)) sourceMap.set(k.key, { row, label: k.label });
  }
  for (const row of dest.rows) {
    const k = rowKey(row, destKeys);
    if (!k.ok) {
      skippedNullKeys += 1;
      continue;
    }
    if (!destMap.has(k.key)) destMap.set(k.key, { row, label: k.label });
  }

  const inserts: ClassifiedRowDiff[] = [];
  const updates: ClassifiedRowDiff[] = [];
  const deletes: ClassifiedRowDiff[] = [];

  for (const [key, src] of sourceMap) {
    const dst = destMap.get(key);
    if (!dst) {
      inserts.push({ op: 'insert', keyLabel: src.label, sourceRow: src.row });
      continue;
    }
    if (
      nonKeyColumnsDiffer(
        src.row,
        dst.row,
        source.columns,
        dest.columns,
        keyNamesLower,
        ignoreLower
      )
    ) {
      updates.push({
        op: 'update',
        keyLabel: src.label,
        sourceRow: src.row,
        destRow: dst.row,
      });
    }
  }
  for (const [key, dst] of destMap) {
    if (sourceMap.has(key)) continue;
    deletes.push({ op: 'delete', keyLabel: dst.label, destRow: dst.row });
  }

  return {
    inserts,
    updates,
    deletes,
    skippedNullKeys,
    totalOps: inserts.length + updates.length + deletes.length,
  };
}

/** Filter by enabled ops and apply the 500-row cap (stable order: insert, update, delete). */
export function selectMigrateOps(
  classification: RowDiffClassification,
  enabled: { insert: boolean; update: boolean; delete: boolean },
  cap = DATA_MIGRATE_ROW_CAP
): { ops: ClassifiedRowDiff[]; truncated: boolean; uncappedCount: number } {
  const all: ClassifiedRowDiff[] = [];
  if (enabled.insert) all.push(...classification.inserts);
  if (enabled.update) all.push(...classification.updates);
  if (enabled.delete) all.push(...classification.deletes);
  const uncappedCount = all.length;
  if (all.length <= cap) return { ops: all, truncated: false, uncappedCount };
  return { ops: all.slice(0, cap), truncated: true, uncappedCount };
}
