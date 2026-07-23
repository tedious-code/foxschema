/**
 * Quote-escaped CSV join + Blob download for SQL Editor result grids.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV string from column headers + row arrays (server-shaped). */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const header = columns.map(escapeCell).join(',');
  const body = rows.map((row) => row.map(escapeCell).join(','));
  return [header, ...body].join('\n');
}

/** Trigger a browser download of the CSV. No-op when columns are empty. */
export function downloadCsv(filename: string, columns: string[], rows: unknown[][]): void {
  if (columns.length === 0) return;
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
