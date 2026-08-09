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
  const s = String(value);
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
