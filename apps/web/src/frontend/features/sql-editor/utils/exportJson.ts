/**
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * JSON serialisation + download for SQL Editor result grids.
 *
 * Rows become objects keyed by column name — the shape people expect to feed
 * to a script or an API — rather than the wire format's positional arrays.
 */

/**
 * A result set can repeat a column name (`SELECT a.id, b.id …`), and an object
 * key cannot. Later duplicates get a numeric suffix so no value is silently
 * dropped; an unnamed column falls back to its position.
 */
export function uniqueKeys(columns: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return columns.map((raw, i) => {
    const base = raw && raw.length > 0 ? raw : `column_${i + 1}`;
    const prior = seen.get(base);
    if (prior === undefined) {
      seen.set(base, 1);
      return base;
    }
    // Keep bumping until the suffixed name is itself unused — a result set can
    // legitimately contain both `id` twice and a literal `id_2`.
    let n = prior;
    let candidate = `${base}_${++n}`;
    while (seen.has(candidate)) candidate = `${base}_${++n}`;
    seen.set(base, n);
    seen.set(candidate, 1);
    return candidate;
  });
}

/**
 * BigInt has no JSON representation and makes `JSON.stringify` throw, which
 * would abort the whole export. Emit it as a string so precision survives —
 * a number would silently round past 2^53.
 */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Build the row objects, in the column order given. */
export function toJsonRows(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): Record<string, unknown>[] {
  const keys = uniqueKeys(columns);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      out[key] = jsonSafe(row[i] ?? null);
    });
    return out;
  });
}

/** Pretty-printed JSON array of row objects. */
export function toJson(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): string {
  return JSON.stringify(toJsonRows(columns, rows), null, 2);
}

/** Trigger a browser download of the JSON. No-op when columns are empty. */
export function downloadJson(
  filename: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): void {
  if (columns.length === 0) return;
  const blob = new Blob([toJson(columns, rows)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
