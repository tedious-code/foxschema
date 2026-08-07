/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Key-align two result grids so matching keys share a row index (friendlier
 * than ORDER BY index compare). Used by SQL Editor side-by-side Compare.
 */

import {
  type CellDiffKind,
  type GridDiffSummary,
  type ResultGridLike,
  type ResultPairDiff,
  resultValuesEqual,
} from './resultDataDiff';
import { keyColumnsForGrid } from './resultRowDiff';

export type AlignRowOp = 'match' | 'update' | 'insert' | 'delete';

export interface KeyAlignedGrids {
  keyNames: string[];
  /** Display rows (gaps are all-null placeholder rows). */
  leftRows: unknown[][];
  rightRows: unknown[][];
  /** True when that side has no real row at this aligned index. */
  leftGap: boolean[];
  rightGap: boolean[];
  rowOps: AlignRowOp[];
  matchCount: number;
  updateCount: number;
  insertCount: number;
  deleteCount: number;
}

function emptySummary(): GridDiffSummary {
  return {
    cells: new Map(),
    modified: 0,
    missing: 0,
    extra: 0,
    missingColumns: [],
    extraColumns: [],
  };
}

function mark(
  summary: GridDiffSummary,
  rowIdx: number,
  colIdx: number,
  kind: CellDiffKind
): void {
  const key = `${rowIdx}:${colIdx}`;
  if (summary.cells.has(key)) return;
  summary.cells.set(key, kind);
  if (kind === 'modified') summary.modified += 1;
  else if (kind === 'missing') summary.missing += 1;
  else summary.extra += 1;
}

function nullRow(width: number): unknown[] {
  return Array.from({ length: width }, () => null);
}

function rowKeyParts(
  row: unknown[],
  keys: ReturnType<typeof keyColumnsForGrid>
): string | null {
  const parts: string[] = [];
  for (const k of keys) {
    if (k.resultIndex < 0) return null;
    const v = row[k.resultIndex];
    if (v === null || v === undefined) return null;
    parts.push(`${k.name.toLowerCase()}=${String(v)}`);
  }
  return parts.join('|');
}

/**
 * Reorder left/right so shared keys line up. Order: matches & updates (left
 * encounter order), then left-only (delete), then right-only (insert).
 * Returns null when keys are missing from either grid.
 */
export function alignResultGridsByKey(
  left: ResultGridLike,
  right: ResultGridLike,
  keyNames: string[],
  opts?: { ignoreColumns?: string[] }
): KeyAlignedGrids | null {
  if (keyNames.length === 0) return null;
  const leftKeys = keyColumnsForGrid(keyNames, left.columns);
  const rightKeys = keyColumnsForGrid(keyNames, right.columns);
  if (
    leftKeys.some((k) => k.resultIndex < 0) ||
    rightKeys.some((k) => k.resultIndex < 0)
  ) {
    return null;
  }

  const ignoreLower = new Set((opts?.ignoreColumns ?? []).map((c) => c.toLowerCase()));
  const keyLower = new Set(keyNames.map((k) => k.toLowerCase()));

  const leftMap = new Map<string, unknown[]>();
  const leftOrder: string[] = [];
  for (const row of left.rows) {
    const k = rowKeyParts(row, leftKeys);
    if (k == null) continue;
    if (!leftMap.has(k)) {
      leftMap.set(k, row);
      leftOrder.push(k);
    }
  }
  const rightMap = new Map<string, unknown[]>();
  const rightOrder: string[] = [];
  for (const row of right.rows) {
    const k = rowKeyParts(row, rightKeys);
    if (k == null) continue;
    if (!rightMap.has(k)) {
      rightMap.set(k, row);
      rightOrder.push(k);
    }
  }

  const leftRows: unknown[][] = [];
  const rightRows: unknown[][] = [];
  const leftGap: boolean[] = [];
  const rightGap: boolean[] = [];
  const rowOps: AlignRowOp[] = [];
  let matchCount = 0;
  let updateCount = 0;
  let insertCount = 0;
  let deleteCount = 0;

  const seenRight = new Set<string>();

  for (const k of leftOrder) {
    const lRow = leftMap.get(k)!;
    const rRow = rightMap.get(k);
    if (rRow) {
      seenRight.add(k);
      const changed = nonKeyDiffer(
        lRow,
        rRow,
        left.columns,
        right.columns,
        keyLower,
        ignoreLower
      );
      leftRows.push(lRow);
      rightRows.push(rRow);
      leftGap.push(false);
      rightGap.push(false);
      if (changed) {
        rowOps.push('update');
        updateCount += 1;
      } else {
        rowOps.push('match');
        matchCount += 1;
      }
    } else {
      leftRows.push(lRow);
      rightRows.push(nullRow(right.columns.length));
      leftGap.push(false);
      rightGap.push(true);
      rowOps.push('delete');
      deleteCount += 1;
    }
  }

  for (const k of rightOrder) {
    if (seenRight.has(k) || leftMap.has(k)) continue;
    const rRow = rightMap.get(k)!;
    leftRows.push(nullRow(left.columns.length));
    rightRows.push(rRow);
    leftGap.push(true);
    rightGap.push(false);
    rowOps.push('insert');
    insertCount += 1;
  }

  return {
    keyNames,
    leftRows,
    rightRows,
    leftGap,
    rightGap,
    rowOps,
    matchCount,
    updateCount,
    insertCount,
    deleteCount,
  };
}

function nonKeyDiffer(
  leftRow: unknown[],
  rightRow: unknown[],
  leftCols: string[],
  rightCols: string[],
  keyLower: Set<string>,
  ignoreLower: Set<string>
): boolean {
  const rightIdx = new Map<string, number>();
  rightCols.forEach((c, i) => {
    const k = c.toLowerCase();
    if (!rightIdx.has(k)) rightIdx.set(k, i);
  });
  for (let i = 0; i < leftCols.length; i++) {
    const name = leftCols[i]!;
    const lower = name.toLowerCase();
    if (keyLower.has(lower) || ignoreLower.has(lower)) continue;
    const ri = rightIdx.get(lower);
    if (ri === undefined) continue;
    if (!resultValuesEqual(leftRow[i], rightRow[ri])) return true;
  }
  return false;
}

/** Build cell tint maps for a key-aligned pair (display indexes). */
export function compareKeyAlignedGrids(
  left: ResultGridLike,
  right: ResultGridLike,
  aligned: KeyAlignedGrids,
  opts?: { ignoreColumns?: string[] }
): ResultPairDiff {
  const baseSum = emptySummary();
  const otherSum = emptySummary();
  const ignore = new Set((opts?.ignoreColumns ?? []).map((c) => c.toLowerCase()));

  const leftByName = new Map<string, number>();
  left.columns.forEach((c, i) => {
    const k = c.toLowerCase();
    if (!leftByName.has(k)) leftByName.set(k, i);
  });
  const rightByName = new Map<string, number>();
  right.columns.forEach((c, i) => {
    const k = c.toLowerCase();
    if (!rightByName.has(k)) rightByName.set(k, i);
  });

  for (const [k, idx] of leftByName) {
    if (ignore.has(k)) continue;
    if (!rightByName.has(k)) baseSum.missingColumns.push(left.columns[idx]!);
  }
  for (const [k, idx] of rightByName) {
    if (ignore.has(k)) continue;
    if (!leftByName.has(k)) otherSum.extraColumns.push(right.columns[idx]!);
  }
  otherSum.missingColumns = [...baseSum.missingColumns];
  baseSum.extraColumns = [...otherSum.extraColumns];

  const shared: { leftIdx: number; rightIdx: number }[] = [];
  for (const [k, leftIdx] of leftByName) {
    if (ignore.has(k)) continue;
    const rightIdx = rightByName.get(k);
    if (rightIdx === undefined) continue;
    shared.push({ leftIdx, rightIdx });
  }

  for (let r = 0; r < aligned.rowOps.length; r++) {
    const op = aligned.rowOps[r]!;
    if (op === 'match') continue;

    if (op === 'delete') {
      for (const { leftIdx } of shared) mark(baseSum, r, leftIdx, 'missing');
      for (const [k, leftIdx] of leftByName) {
        if (ignore.has(k) || rightByName.has(k)) continue;
        mark(baseSum, r, leftIdx, 'missing');
      }
      continue;
    }

    if (op === 'insert') {
      for (const { rightIdx } of shared) mark(otherSum, r, rightIdx, 'extra');
      for (const [k, rightIdx] of rightByName) {
        if (ignore.has(k) || leftByName.has(k)) continue;
        mark(otherSum, r, rightIdx, 'extra');
      }
      continue;
    }

    // update — tint only cells that actually differ
    const lRow = aligned.leftRows[r]!;
    const rRow = aligned.rightRows[r]!;
    for (const { leftIdx, rightIdx } of shared) {
      if (resultValuesEqual(lRow[leftIdx], rRow[rightIdx])) continue;
      mark(baseSum, r, leftIdx, 'modified');
      mark(otherSum, r, rightIdx, 'modified');
    }
    for (const [k, rightIdx] of rightByName) {
      if (ignore.has(k) || leftByName.has(k)) continue;
      mark(otherSum, r, rightIdx, 'extra');
    }
    for (const [k, leftIdx] of leftByName) {
      if (ignore.has(k) || rightByName.has(k)) continue;
      mark(baseSum, r, leftIdx, 'missing');
    }
  }

  return {
    baseline: baseSum,
    other: otherSum,
    totalDiffCells: baseSum.cells.size + otherSum.cells.size,
  };
}
