/**
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Clipboard serialisation for SQL Editor result grids.
 *
 * Tab-separated, not comma-separated: Excel and Google Sheets split pasted
 * text on tabs natively, while pasted CSV lands in a single column until the
 * user runs Text-to-Columns. The downloaded `.csv` file stays comma-separated
 * (see `exportCsv.ts`) — a file goes through the spreadsheet's CSV importer,
 * the clipboard does not.
 */
import { neutralizeSpreadsheetFormula } from '@/features/sql-editor/utils/spreadsheetSafety';

/**
 * Excel's clipboard dialect: a field is quoted only when it contains a tab, a
 * newline, or a quote, and inner quotes double. Without this a value holding a
 * tab would silently become two cells, and one holding a newline would become
 * two rows — the pasted sheet would look plausible while being misaligned.
 */
function escapeCell(value: unknown): string {
  // SQL NULL and absent values both paste as an empty cell, matching the CSV
  // export. The grid renders NULL as the word "NULL"; copying that literal
  // would turn a numeric column into text on paste.
  if (value === null || value === undefined) return '';
  // A pasted cell is evaluated by the spreadsheet exactly like an imported one.
  const s = typeof value === 'number' ? String(value) : neutralizeSpreadsheetFormula(String(value));
  if (/["\t\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build the clipboard payload for a grid.
 *
 * Rows are already in display order — the caller maps the user's reordered
 * columns, so what lands on the clipboard matches what is on screen.
 *
 * Line endings are CRLF: Excel on Windows treats a bare LF inside a quoted
 * field inconsistently, and every target we care about accepts CRLF.
 */
export function toTsv(
  columns: string[] | null,
  rows: readonly (readonly unknown[])[]
): string {
  const lines: string[] = [];
  if (columns && columns.length > 0) lines.push(columns.map(escapeCell).join('\t'));
  for (const row of rows) lines.push(row.map(escapeCell).join('\t'));
  return lines.join('\r\n');
}

export type GridRange = {
  /** Inclusive row indices into `rows`. */
  row0: number;
  row1: number;
  /** Inclusive display-order column positions (0 = leftmost). */
  col0: number;
  col1: number;
};

/**
 * Slice a rectangular selection out of a grid.
 *
 * `displayOrder` is the on-screen column permutation (source indices). The
 * range's `col0`/`col1` are positions in that order, so a drag from the
 * leftmost visible column to the next one copies those two, even if the user
 * reordered them. Out-of-range corners clamp; an inverted drag is normalised.
 */
export function sliceGridRange(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  range: GridRange,
  displayOrder: readonly number[] | null = null
): { columns: string[]; rows: unknown[][] } {
  const order = displayOrder ?? columns.map((_, i) => i);
  if (columns.length === 0 || rows.length === 0 || order.length === 0) {
    return { columns: [], rows: [] };
  }
  const r0 = Math.max(0, Math.min(range.row0, range.row1));
  const r1 = Math.min(rows.length - 1, Math.max(range.row0, range.row1));
  const c0 = Math.max(0, Math.min(range.col0, range.col1));
  const c1 = Math.min(order.length - 1, Math.max(range.col0, range.col1));
  if (r0 > r1 || c0 > c1) return { columns: [], rows: [] };
  const idxs = order.slice(c0, c1 + 1).filter((i) => Number.isInteger(i) && i >= 0 && i < columns.length);
  return {
    columns: idxs.map((i) => columns[i]!),
    rows: rows.slice(r0, r1 + 1).map((row) => idxs.map((i) => row[i])),
  };
}

/**
 * Narrow a grid to a chosen set of columns, in the order chosen.
 *
 * `indices` is the output order, not a filter over the existing order — the
 * caller records the order the user picked columns in, so copying `name, id`
 * from a grid showing `id, name` produces `name, id`. Passing `null` keeps the
 * grid as-is.
 *
 * Out-of-range and repeated indices are dropped rather than producing empty or
 * duplicated cells: the selection can outlive the result set it was made
 * against (re-run a query with fewer columns and the stale picks must not
 * corrupt the copy).
 */
export function pickColumns(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  indices: readonly number[] | null
): { columns: string[]; rows: unknown[][] } {
  if (indices === null) {
    return { columns: [...columns], rows: rows.map((r) => [...r]) };
  }
  const seen = new Set<number>();
  const valid: number[] = [];
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= columns.length || seen.has(i)) continue;
    seen.add(i);
    valid.push(i);
  }
  return {
    columns: valid.map((i) => columns[i]!),
    rows: rows.map((row) => valid.map((i) => row[i])),
  };
}

/**
 * Write text to the clipboard, reporting success rather than throwing.
 *
 * `navigator.clipboard` rejects when the document is not focused or the
 * context is insecure; callers surface that instead of leaving the user
 * thinking a copy happened.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Discontiguous selection ────────────────────────────────────────────────

/**
 * A selection is a list of rectangles, not one rectangle.
 *
 * Dragging still produces a single entry; Cmd/Ctrl-click adds another. Keeping
 * the list ordered by when each was added means the most recent one is the
 * anchor for a subsequent shift-extend, which is what every spreadsheet does.
 */
export type GridSelection = readonly GridRange[];

function normalize(r: GridRange) {
  return {
    r0: Math.min(r.row0, r.row1),
    r1: Math.max(r.row0, r.row1),
    c0: Math.min(r.col0, r.col1),
    c1: Math.max(r.col0, r.col1),
  };
}

export function selectionHasCell(sel: GridSelection, row: number, col: number): boolean {
  return sel.some((r) => {
    const n = normalize(r);
    return row >= n.r0 && row <= n.r1 && col >= n.c0 && col <= n.c1;
  });
}

/** Distinct cells, so overlapping rectangles are not counted twice. */
export function selectionCellCount(sel: GridSelection): number {
  const seen = new Set<string>();
  for (const r of sel) {
    const n = normalize(r);
    for (let row = n.r0; row <= n.r1; row++) {
      for (let col = n.c0; col <= n.c1; col++) seen.add(`${row}:${col}`);
    }
  }
  return seen.size;
}

/**
 * Flatten a possibly discontiguous selection into a rectangle to copy.
 *
 * Excel simply refuses this ("that command cannot be used on multiple
 * selections"), which is not helpful when someone has deliberately picked four
 * scattered cells. Instead: keep every row and column the selection touches,
 * and blank the cells inside that box which are not selected. The result
 * pastes as a grid whose filled cells are exactly what was picked, and their
 * relative positions survive.
 */
export function sliceGridSelection(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  sel: GridSelection,
  displayOrder: readonly number[] | null = null
): { columns: string[]; rows: unknown[][] } {
  const order = displayOrder ?? columns.map((_, i) => i);
  if (sel.length === 0 || columns.length === 0 || rows.length === 0) {
    return { columns: [], rows: [] };
  }
  if (sel.length === 1) return sliceGridRange(columns, rows, sel[0]!, order);

  const rowSet = new Set<number>();
  const colSet = new Set<number>();
  for (const r of sel) {
    const n = normalize(r);
    for (let row = Math.max(0, n.r0); row <= Math.min(rows.length - 1, n.r1); row++) rowSet.add(row);
    for (let col = Math.max(0, n.c0); col <= Math.min(order.length - 1, n.c1); col++) colSet.add(col);
  }
  const rowList = [...rowSet].sort((a, b) => a - b);
  const colList = [...colSet].sort((a, b) => a - b);
  const idxs = colList
    .map((c) => order[c]!)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < columns.length);

  return {
    columns: colList.map((c) => columns[order[c]!] ?? '').filter((_, i) => idxs[i] !== undefined),
    rows: rowList.map((row) =>
      colList.map((col) => (selectionHasCell(sel, row, col) ? rows[row]?.[order[col]!] : null))
    ),
  };
}
