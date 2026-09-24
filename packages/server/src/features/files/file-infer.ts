/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Column type inference and cell coercion for imported files.
 *
 * Kept free of imports on purpose: the file-parse worker needs these, and
 * pulling them from the bulk writer would load `@foxschema/db` (every driver
 * adapter) into each worker it starts.
 */

export type InferredSqlType = 'INTEGER' | 'REAL' | 'TEXT';

export function inferColumnTypes(columns: string[], matrix: unknown[][]): InferredSqlType[] {
  return columns.map((_, i) => inferType(matrix.map((r) => r[i])));
}

function inferType(values: unknown[]): InferredSqlType {
  let sawReal = false;
  let sawInt = false;
  for (const v of values) {
    if (v == null || v === '') continue;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) sawInt = true;
      else sawReal = true;
      continue;
    }
    const s = String(v).trim();
    if (s === '') continue;
    if (/^[+-]?\d+$/.test(s)) {
      sawInt = true;
      continue;
    }
    // Prior grammar: [+-]?(digits.digits* | .digits)(e[+-]?digits)?
    // Split forms keep that (incl. `123.` / `1.e10`) without a ReDoS-prone
    // alternation (eslint security/detect-unsafe-regex).
    if (
      /^[+-]?\d+\.\d*$/.test(s) ||
      /^[+-]?\.\d+$/.test(s) ||
      /^[+-]?\d+\.\d*[eE][+-]?\d+$/.test(s) ||
      /^[+-]?\.\d+[eE][+-]?\d+$/.test(s)
    ) {
      sawReal = true;
      continue;
    }
    return 'TEXT';
  }
  if (sawReal) return 'REAL';
  if (sawInt) return 'INTEGER';
  return 'TEXT';
}

export function coerceCell(v: unknown, type: InferredSqlType): unknown {
  if (v == null || v === '') return null;
  if (type === 'INTEGER') {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (type === 'REAL') {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
