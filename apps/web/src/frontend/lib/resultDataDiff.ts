/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compare two query-result grids cell-by-cell (row index + column name).
 * Used by SQL Editor side-by-side results to color differences.
 */

import { normalizeResultValue } from './resultValueKey';

export type CellDiffKind = 'modified' | 'missing' | 'extra';

export interface ResultGridLike {
  columns: string[];
  rows: unknown[][];
}

export interface GridDiffSummary {
  /** `${rowIdx}:${colIdx}` → kind for this grid's column indexes. */
  cells: Map<string, CellDiffKind>;
  modified: number;
  missing: number;
  extra: number;
  /** Column names present in baseline but not this grid. */
  missingColumns: string[];
  /** Column names present in this grid but not baseline. */
  extraColumns: string[];
}

export interface ResultPairDiff {
  baseline: GridDiffSummary;
  other: GridDiffSummary;
  /** Total differing cells across both grids (each side counted). */
  totalDiffCells: number;
}

/**
 * Cell equality across dialects.
 *
 * Both sides go through {@link normalizeResultValue}. Row matching uses
 * {@link normalizeResultKey} instead — that keeps VARCHAR key strings exact
 * while still folding DECIMAL scale here for cell tinting.
 */
export function resultValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // null === null covers NULL == NULL; a null on one side only never matches.
  return normalizeResultValue(a) === normalizeResultValue(b);
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

function colKey(name: string): string {
  return name.toLowerCase();
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

/**
 * Diff `other` against `baseline`. Rows align by index within the current page;
 * columns align by case-insensitive name. Prefer identical ORDER BY on both
 * servers so row indexes mean the same entity.
 *
 * `ignoreColumns` skips value compares (e.g. trigger-managed createdAt / updatedBy).
 */
export function compareResultGrids(
  baseline: ResultGridLike,
  other: ResultGridLike,
  opts?: { ignoreColumns?: string[] }
): ResultPairDiff {
  const baseSum = emptySummary();
  const otherSum = emptySummary();
  const ignore = new Set((opts?.ignoreColumns ?? []).map((c) => c.toLowerCase()));

  const baseByName = new Map<string, number>();
  for (let i = 0; i < baseline.columns.length; i++) {
    const name = baseline.columns[i]!;
    const k = colKey(name);
    if (!baseByName.has(k)) baseByName.set(k, i);
  }
  const otherByName = new Map<string, number>();
  for (let i = 0; i < other.columns.length; i++) {
    const name = other.columns[i]!;
    const k = colKey(name);
    if (!otherByName.has(k)) otherByName.set(k, i);
  }

  for (const [k, idx] of baseByName) {
    if (ignore.has(k)) continue;
    if (!otherByName.has(k)) {
      baseSum.missingColumns.push(baseline.columns[idx]!);
    }
  }
  for (const [k, idx] of otherByName) {
    if (ignore.has(k)) continue;
    if (!baseByName.has(k)) {
      otherSum.extraColumns.push(other.columns[idx]!);
    }
  }
  // Mirror column lists onto the opposite summary for UI convenience.
  otherSum.missingColumns = [...baseSum.missingColumns];
  baseSum.extraColumns = [...otherSum.extraColumns];

  const shared: { name: string; baseIdx: number; otherIdx: number }[] = [];
  for (const [k, baseIdx] of baseByName) {
    if (ignore.has(k)) continue;
    const otherIdx = otherByName.get(k);
    if (otherIdx === undefined) continue;
    shared.push({ name: baseline.columns[baseIdx]!, baseIdx, otherIdx });
  }

  const rowCount = Math.max(baseline.rows.length, other.rows.length);
  for (let r = 0; r < rowCount; r++) {
    const baseRow = baseline.rows[r];
    const otherRow = other.rows[r];

    if (baseRow && !otherRow) {
      for (const { baseIdx } of shared) {
        mark(baseSum, r, baseIdx, 'missing');
      }
      continue;
    }
    if (otherRow && !baseRow) {
      for (const { otherIdx } of shared) {
        mark(otherSum, r, otherIdx, 'extra');
      }
      // Extra-only columns on this row
      for (const [k, otherIdx] of otherByName) {
        if (ignore.has(k) || baseByName.has(k)) continue;
        mark(otherSum, r, otherIdx, 'extra');
      }
      continue;
    }
    if (!baseRow || !otherRow) continue;

    for (const { baseIdx, otherIdx } of shared) {
      const a = baseRow[baseIdx];
      const b = otherRow[otherIdx];
      if (resultValuesEqual(a, b)) continue;
      mark(baseSum, r, baseIdx, 'modified');
      mark(otherSum, r, otherIdx, 'modified');
    }

    // Columns only on other → extra cells
    for (const [k, otherIdx] of otherByName) {
      if (ignore.has(k) || baseByName.has(k)) continue;
      mark(otherSum, r, otherIdx, 'extra');
    }
    // Columns only on baseline → missing on other side is shown via missingColumns;
    // tint baseline cells so the gap is visible while scanning.
    for (const [k, baseIdx] of baseByName) {
      if (ignore.has(k) || otherByName.has(k)) continue;
      mark(baseSum, r, baseIdx, 'missing');
    }
  }

  return {
    baseline: baseSum,
    other: otherSum,
    totalDiffCells: baseSum.cells.size + otherSum.cells.size,
  };
}

export function cellDiffKey(rowIdx: number, colIdx: number): string {
  return `${rowIdx}:${colIdx}`;
}

export const CELL_DIFF_CLASS: Record<CellDiffKind, string> = {
  modified: 'bg-amber-500/25 ring-1 ring-inset ring-amber-400/40',
  missing: 'bg-rose-500/20 ring-1 ring-inset ring-rose-400/35',
  extra: 'bg-emerald-500/20 ring-1 ring-inset ring-emerald-400/35',
};
