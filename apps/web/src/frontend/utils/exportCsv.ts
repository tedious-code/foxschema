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

export type MultiGridCsvPane = {
  /** Prefix for this pane's columns (Source, Target, …). */
  label: string;
  columns: string[];
  rows: unknown[][];
};

export type MultiGridCsvMeta = {
  /** Optional leading columns (op / key) shared across all panes. */
  leadingColumns?: string[];
  /** Per-row values for leadingColumns (same length as rowCount). */
  leadingRows?: unknown[][];
};

function sanitizePrefix(label: string): string {
  const cleaned = label.replace(/[\r\n,]+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'grid';
}

/**
 * Side-by-side multi-grid CSV: each pane's columns are prefixed with its label
 * (`Source.id`, `Target.id`, …). Shorter panes pad with empty cells.
 */
export function buildMultiGridCsv(
  panes: MultiGridCsvPane[],
  meta?: MultiGridCsvMeta
): { columns: string[]; rows: unknown[][] } {
  const leadingColumns = meta?.leadingColumns ?? [];
  const leadingRows = meta?.leadingRows ?? [];
  const columns: string[] = [...leadingColumns];
  for (const pane of panes) {
    const prefix = sanitizePrefix(pane.label);
    for (const col of pane.columns) {
      columns.push(`${prefix}.${col}`);
    }
  }
  const rowCount = Math.max(
    0,
    leadingRows.length,
    ...panes.map((p) => p.rows.length)
  );
  const rows: unknown[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: unknown[] = [];
    const lead = leadingRows[r];
    for (let i = 0; i < leadingColumns.length; i++) {
      row.push(lead?.[i] ?? '');
    }
    for (const pane of panes) {
      const src = pane.rows[r];
      for (let c = 0; c < pane.columns.length; c++) {
        row.push(src?.[c] ?? '');
      }
    }
    rows.push(row);
  }
  return { columns, rows };
}

/** Download one CSV with all compare panes side-by-side. */
export function downloadMultiGridCsv(
  filename: string,
  panes: MultiGridCsvPane[],
  meta?: MultiGridCsvMeta
): void {
  const { columns, rows } = buildMultiGridCsv(panes, meta);
  downloadCsv(filename, columns, rows);
}
