/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Last Id paging: when ORDER BY is a unique key prefix, Next walks from the
 * last row instead of OFFSET. Jumping to an unvisited page N falls back to
 * OFFSET (or is refused by the server when a seek is also sent).
 */
import {
  parseTopLevelOrderBy,
  uniqueKeyCoversOrder,
  uniqueKeysFromTable,
} from '@foxschema/sql';
import type { TableSchema } from '@/shared/lib/types';

export type ResultSeek = {
  columns: string[];
  values: unknown[];
  descending: boolean[];
};

export function tableForOrderBy(
  sql: string,
  tables: readonly TableSchema[] | undefined
): TableSchema | undefined {
  if (!tables?.length) return undefined;
  const names = sql.toLowerCase();
  return tables.find((t) => names.includes(t.name.toLowerCase()));
}

export function seekFromLastRow(opts: {
  sql: string;
  table?: TableSchema;
  resultColumns: readonly string[];
  lastRow: readonly unknown[];
}): ResultSeek | null {
  const parsed = parseTopLevelOrderBy(opts.sql);
  if (!parsed || !opts.table) return null;
  const orderCols = parsed.terms.map((t) => t.column);
  if (!uniqueKeyCoversOrder(uniqueKeysFromTable(opts.table), orderCols)) return null;
  const values: unknown[] = [];
  for (const col of orderCols) {
    const i = opts.resultColumns.findIndex((c) => c.toLowerCase() === col.toLowerCase());
    if (i < 0) return null;
    const v = opts.lastRow[i];
    if (v === null || v === undefined) return null;
    values.push(v);
  }
  return {
    columns: orderCols,
    values,
    descending: parsed.terms.map((t) => t.descending),
  };
}
