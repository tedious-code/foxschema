/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build bound UPDATE / INSERT / DELETE for Data Peek single-table CRUD.
 * Requires a resolvable primary key (or unique index) present in the result columns.
 */

import { sqlTag as sql, renderSqlQuery } from './sql-splitter';
import { tableNameParts } from './tablePreview';
import type { TableSchema } from './types';

export type PeekWriteKind = 'update' | 'insert' | 'delete';

export interface PeekKeyColumn {
  name: string;
  /** Index in the result `columns` array, or -1 if not present in the grid. */
  resultIndex: number;
}

export interface PeekWritePlan {
  kind: PeekWriteKind;
  sql: string;
  params: unknown[];
  /** Human-readable preview (same as sql for bound statements). */
  displaySql: string;
}

export interface PeekEditability {
  editable: boolean;
  reason?: string;
  keyColumns: PeekKeyColumn[];
  /** Column names from the table that appear in the result set. */
  editableColumns: string[];
  /** Identity / autoincrement columns — skipped on INSERT unless user fills them. */
  identityColumns: Set<string>;
}

/** Dialects that reject writes in the SQL Editor adapters. */
const PEEK_READONLY_DIALECTS = new Set(['clickhouse']);

function resultIndexMap(columns: string[]): Map<string, number> {
  const map = new Map<string, number>();
  columns.forEach((c, i) => map.set(c.toLowerCase(), i));
  return map;
}

/**
 * Resolve PK columns for a table that appear in the current result columns.
 * Falls back to a single unique index when no PK is declared.
 */
export function resolvePeekKeyColumns(
  table: TableSchema | undefined,
  resultColumns: string[]
): PeekKeyColumn[] {
  if (!table) return [];
  const idx = resultIndexMap(resultColumns);
  const pkNames =
    table.primaryKey?.columns?.length
      ? table.primaryKey.columns
      : table.columns.filter((c) => c.primaryKey).map((c) => c.name);
  if (pkNames.length) {
    return pkNames.map((name) => ({
      name,
      resultIndex: idx.get(name.toLowerCase()) ?? -1,
    }));
  }
  const unique = table.indices.find((i) => i.unique && i.columns.length > 0);
  if (unique) {
    return unique.columns.map((name) => ({
      name,
      resultIndex: idx.get(name.toLowerCase()) ?? -1,
    }));
  }
  return [];
}

export function assessPeekEditability(opts: {
  dialect: string;
  table: TableSchema | undefined;
  resultColumns: string[];
}): PeekEditability {
  const { dialect, table, resultColumns } = opts;
  if (PEEK_READONLY_DIALECTS.has(dialect.toLowerCase())) {
    return {
      editable: false,
      reason: 'This dialect is read-only — Data Peek cannot write rows.',
      keyColumns: [],
      editableColumns: [],
      identityColumns: new Set(),
    };
  }
  if (!table) {
    return {
      editable: false,
      reason: 'Load the schema for this connection to enable row editing.',
      keyColumns: [],
      editableColumns: [],
      identityColumns: new Set(),
    };
  }
  if (table.objectType !== 'TABLE' && table.objectType !== 'MQT') {
    return {
      editable: false,
      reason: `${table.objectType} objects are not editable in Data Peek.`,
      keyColumns: [],
      editableColumns: [],
      identityColumns: new Set(),
    };
  }
  const keyColumns = resolvePeekKeyColumns(table, resultColumns);
  if (keyColumns.length === 0) {
    return {
      editable: false,
      reason: 'No primary key or unique index found — cannot safely UPDATE/DELETE.',
      keyColumns: [],
      editableColumns: [],
      identityColumns: new Set(),
    };
  }
  if (keyColumns.some((k) => k.resultIndex < 0)) {
    return {
      editable: false,
      reason: 'Primary key columns are missing from this result set.',
      keyColumns,
      editableColumns: [],
      identityColumns: new Set(),
    };
  }
  const colSet = new Set(resultColumns.map((c) => c.toLowerCase()));
  const editableColumns = table.columns
    .map((c) => c.name)
    .filter((name) => colSet.has(name.toLowerCase()));
  const identityColumns = new Set(
    table.columns.filter((c) => c.identity || c.identityGeneration).map((c) => c.name)
  );
  return {
    editable: true,
    keyColumns,
    editableColumns,
    identityColumns,
  };
}

function rowToRecord(columns: string[], row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  columns.forEach((c, i) => {
    out[c] = row[i] ?? null;
  });
  return out;
}

/** Build UPDATE … SET … WHERE pk = … for one dirty row. */
export function buildPeekUpdate(opts: {
  tableName: string;
  dialect: string;
  columns: string[];
  originalRow: unknown[];
  draftRow: unknown[];
  keyColumns: PeekKeyColumn[];
}): PeekWritePlan | { error: string } {
  const { tableName, dialect, columns, originalRow, draftRow, keyColumns } = opts;
  const parts = tableNameParts(tableName);
  if (!parts.length) return { error: 'Invalid table name.' };

  const keyLower = new Set(keyColumns.map((k) => k.name.toLowerCase()));
  const setCols: string[] = [];
  const setVals: unknown[] = [];
  for (let i = 0; i < columns.length; i++) {
    const name = columns[i]!;
    if (keyLower.has(name.toLowerCase())) continue;
    if (valuesEqual(originalRow[i], draftRow[i])) continue;
    setCols.push(name);
    setVals.push(draftRow[i] ?? null);
  }
  if (setCols.length === 0) return { error: 'No changes to save.' };

  let query = sql`UPDATE ${sql.id(...parts)} SET `;
  setCols.forEach((col, i) => {
    const sep = i === 0 ? sql`` : sql`, `;
    query = sql`${query}${sep}${sql.id(col)} = ${setVals[i]}`;
  });
  query = sql`${query} WHERE `;
  keyColumns.forEach((k, i) => {
    const sep = i === 0 ? sql`` : sql` AND `;
    const val = originalRow[k.resultIndex];
    if (val === null || val === undefined) {
      query = sql`${query}${sep}${sql.id(k.name)} IS NULL`;
    } else {
      query = sql`${query}${sep}${sql.id(k.name)} = ${val}`;
    }
  });

  const rendered = renderSqlQuery(query, dialect);
  return {
    kind: 'update',
    sql: rendered.text,
    params: rendered.params,
    displaySql: rendered.text,
  };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

/** Build INSERT for a new or cloned row (object keyed by column name). */
export function buildPeekInsert(opts: {
  tableName: string;
  dialect: string;
  values: Record<string, unknown>;
  /** Skip empty identity columns so the engine can generate them. */
  identityColumns?: Set<string>;
}): PeekWritePlan | { error: string } {
  const { tableName, dialect, values, identityColumns } = opts;
  const parts = tableNameParts(tableName);
  if (!parts.length) return { error: 'Invalid table name.' };

  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (identityColumns?.has(k) && (v === '' || v === null || v === undefined)) continue;
    row[k] = v === '' ? null : v;
  }
  if (Object.keys(row).length === 0) return { error: 'Nothing to insert.' };

  const rendered = renderSqlQuery(
    sql`INSERT INTO ${sql.id(...parts)} ${sql.values([row])}`,
    dialect
  );
  return {
    kind: 'insert',
    sql: rendered.text,
    params: rendered.params,
    displaySql: rendered.text,
  };
}

/** Build DELETE WHERE pk = … for one row. */
export function buildPeekDelete(opts: {
  tableName: string;
  dialect: string;
  columns: string[];
  row: unknown[];
  keyColumns: PeekKeyColumn[];
}): PeekWritePlan | { error: string } {
  const { tableName, dialect, row, keyColumns } = opts;
  const parts = tableNameParts(tableName);
  if (!parts.length) return { error: 'Invalid table name.' };
  if (keyColumns.length === 0) return { error: 'No key columns for DELETE.' };

  let query = sql`DELETE FROM ${sql.id(...parts)} WHERE `;
  keyColumns.forEach((k, i) => {
    if (i > 0) query = sql`${query} AND `;
    const val = row[k.resultIndex];
    if (val === null || val === undefined) {
      query = sql`${query}${sql.id(k.name)} IS NULL`;
    } else {
      query = sql`${query}${sql.id(k.name)} = ${val}`;
    }
  });

  const rendered = renderSqlQuery(query, dialect);
  return {
    kind: 'delete',
    sql: rendered.text,
    params: rendered.params,
    displaySql: rendered.text,
  };
}

export function peekRowToDraft(
  columns: string[],
  row: unknown[] | null,
  opts?: { clearKeys?: string[]; clearIdentity?: Set<string> }
): Record<string, string> {
  const draft: Record<string, string> = {};
  for (let i = 0; i < columns.length; i++) {
    const name = columns[i]!;
    if (opts?.clearKeys?.some((k) => k.toLowerCase() === name.toLowerCase())) {
      draft[name] = '';
      continue;
    }
    if (opts?.clearIdentity?.has(name)) {
      draft[name] = '';
      continue;
    }
    const v = row?.[i];
    draft[name] = v == null ? '' : String(v);
  }
  return draft;
}

export function draftToRowValues(
  columns: string[],
  draft: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    const raw = draft[c];
    if (raw === undefined) continue;
    out[c] = raw === '' ? null : raw;
  }
  return out;
}

export function draftToArray(
  columns: string[],
  draft: Record<string, string>,
  original?: unknown[]
): unknown[] {
  return columns.map((c, i) => {
    if (!(c in draft)) return original?.[i] ?? null;
    const raw = draft[c]!;
    if (raw === '') return null;
    const orig = original?.[i];
    if (typeof orig === 'number' && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
      return Number(raw);
    }
    if (typeof orig === 'bigint') {
      try {
        return BigInt(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  });
}

export { rowToRecord };
