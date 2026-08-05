/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Queries behind data peek (schema Cmd/Ctrl-click, or FK click in editor results).
 *
 * Everything here goes through the `sql` template engine, so a drill-down value
 * taken from a grid cell is bound, never pasted into the statement — the value
 * may be any string a row happens to contain.
 *
 * No LIMIT is added: `/sql/execute` already wraps a SELECT with the dialect's
 * paging syntax (see sql-page-wrap.ts), which also gives the peek Next/Prev.
 */

import { sqlTag as sql, renderSqlQuery } from './sql-splitter';
import type { ForeignKeyInfo, TableSchema } from './types';

export interface PreviewQuery {
  sql: string;
  params: unknown[];
}

/** Split `schema.table` into identifier parts, honoring quoted segments. */
export function tableNameParts(qualified: string): string[] {
  const trimmed = qualified.trim();
  if (!trimmed) return [];
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === '"') {
      // "" inside a quoted identifier is a literal quote.
      if (quoted && trimmed[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (ch === '.' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.filter((p) => p.length > 0);
}

/** `SELECT * FROM <table>` — the row cap and paging come from the server. */
export function buildTablePreview(tableName: string, dialect: string): PreviewQuery {
  const parts = tableNameParts(tableName);
  const { text, params } = renderSqlQuery(sql`SELECT * FROM ${sql.id(...parts)}`, dialect);
  return { sql: text, params };
}

/**
 * `SELECT * FROM <parent> WHERE <refCol> = <value> …` for one FK.
 * Returns null when the FK has no usable parent columns (the catalog omitted
 * them and no parent PK was resolvable) — the caller should not offer a link.
 */
export function buildForeignKeyDrilldown(
  fk: ForeignKeyInfo,
  values: unknown[],
  dialect: string
): PreviewQuery | null {
  const refCols = fk.referencedColumns ?? [];
  if (refCols.length === 0 || refCols.length !== values.length) return null;
  if (values.some((v) => v === null || v === undefined)) return null;

  const parts = tableNameParts(fk.referencedTable);
  if (parts.length === 0) return null;

  let query = sql`SELECT * FROM ${sql.id(...parts)} WHERE `;
  refCols.forEach((col, i) => {
    const clause = i === 0 ? sql`` : sql` AND `;
    query = sql`${query}${clause}${sql.id(col)} = ${values[i]}`;
  });
  const { text, params } = renderSqlQuery(query, dialect);
  return { sql: text, params };
}

export interface FkColumnLink {
  /** Index into the result's `columns` that carries the child value. */
  columnIndex: number;
  fk: ForeignKeyInfo;
  /** All column indexes of this FK, in the parent's column order. */
  valueIndexes: number[];
}

/**
 * Map result columns to the foreign keys they participate in, so the grid can
 * render those cells as drill-through links. Column names are matched
 * case-insensitively — Oracle and Db2 fold them to upper case.
 */
export function foreignKeyLinksFor(
  table: TableSchema | undefined,
  resultColumns: string[]
): FkColumnLink[] {
  if (!table?.foreignKeys?.length) return [];
  const indexOf = (name: string) =>
    resultColumns.findIndex((c) => c.toLowerCase() === name.toLowerCase());

  const links: FkColumnLink[] = [];
  for (const fk of table.foreignKeys) {
    const cols = fk.columns ?? [];
    if (cols.length === 0) continue;
    const valueIndexes = cols.map(indexOf);
    // Every column of a composite FK must be present, or the WHERE would be
    // built from a partial key and match the wrong parent rows.
    if (valueIndexes.some((i) => i < 0)) continue;
    links.push({ columnIndex: valueIndexes[0]!, fk, valueIndexes });
  }
  return links;
}

/** Resolve a table name (qualified or bare) against the schema cache. */
export function findCachedTable(
  tables: TableSchema[] | undefined,
  name: string
): TableSchema | undefined {
  if (!tables?.length || !name.trim()) return undefined;
  const wanted = name.toLowerCase();
  const bare = wanted.includes('.') ? wanted.slice(wanted.lastIndexOf('.') + 1) : wanted;
  return (
    tables.find((t) => t.name.toLowerCase() === wanted) ??
    tables.find((t) => {
      const n = t.name.toLowerCase();
      return (n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : n) === bare;
    })
  );
}

/**
 * Tables referenced in a statement (FROM/JOIN/UPDATE/INTO only).
 * Uses a stricter scan than {@link extractTableAliases} so
 * `SELECT a, b FROM t` is not mistaken for a comma-FROM list.
 */
export function tableNamesFromSql(sql: string): string[] {
  if (!sql.trim()) return [];
  const ident =
    '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*(?:\\.[A-Za-z_][\\w$]*)*)';
  const re = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(${ident})`, 'gi');
  const names: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    const cleaned = stripSqlIdent(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(cleaned);
  }
  return names;
}

function stripSqlIdent(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === '`' && b === '`') || (a === '[' && b === ']')) {
      return s.slice(1, -1).replace(/""/g, '"');
    }
  }
  return s;
}

/**
 * Tables referenced in a statement, matched against the schema cache — used to
 * offer FK links on editor result grids.
 */
export function tablesFromSql(
  sql: string,
  tables: TableSchema[] | undefined
): TableSchema[] {
  if (!sql.trim() || !tables?.length) return [];
  const out: TableSchema[] = [];
  const seen = new Set<string>();
  for (const name of tableNamesFromSql(sql)) {
    const table = findCachedTable(tables, name);
    if (!table) continue;
    const key = table.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(table);
  }
  return out;
}

/**
 * FK links for a result set given the statement SQL + schema tables.
 * First table that claims a column wins when joins share FK column names.
 */
export function foreignKeyLinksForSql(
  sql: string,
  tables: TableSchema[] | undefined,
  resultColumns: string[]
): FkColumnLink[] {
  const matched = tablesFromSql(sql, tables);
  if (matched.length === 0) return [];
  const links: FkColumnLink[] = [];
  const claimed = new Set<number>();
  for (const table of matched) {
    for (const link of foreignKeyLinksFor(table, resultColumns)) {
      if (claimed.has(link.columnIndex)) continue;
      claimed.add(link.columnIndex);
      links.push(link);
    }
  }
  return links;
}

/**
 * Free-text WHERE / ORDER BY for Data Peek. Rejects multi-statement and
 * comment tricks so a filter box can't smuggle a second command.
 */
export function isSafePeekClause(clause: string): boolean {
  const t = clause.trim();
  if (!t) return true;
  if (/[;]/.test(t)) return false;
  if (/--/.test(t)) return false;
  if (/\/\*|\*\//.test(t)) return false;
  return true;
}

export interface PeekFilterClauses {
  /** Predicate only — no leading WHERE. ANDed onto the base query. */
  where?: string;
  /** Sort list only — no leading ORDER BY. */
  orderBy?: string;
}

/**
 * Human label for an FK drill base filter (`ID = 33`), or null when the peek
 * is already an unfiltered table preview (no bound base params).
 */
export function peekBaseFilterLabel(
  title: string,
  tableName: string,
  baseParams: unknown[]
): string | null {
  if (!baseParams.length) return null;
  const prefix = `${tableName} · `;
  if (title.startsWith(prefix)) {
    const rest = title.slice(prefix.length).trim();
    return rest || 'filtered';
  }
  const sep = title.indexOf(' · ');
  if (sep >= 0) {
    const rest = title.slice(sep + 3).trim();
    return rest || 'filtered';
  }
  return 'filtered';
}

/**
 * Layer optional user filters onto a peek base query (`SELECT * FROM …`
 * or a bound FK drill). Params stay those of the base; the filter text is
 * not parameterized (same trust model as typing SQL in the editor).
 */
export function composePeekSql(
  baseSql: string,
  baseParams: unknown[],
  filters: PeekFilterClauses = {}
): PreviewQuery | { error: string } {
  const where = (filters.where ?? '').trim();
  const orderBy = (filters.orderBy ?? '').trim();
  if (!isSafePeekClause(where)) {
    return { error: 'WHERE must be a single predicate (no ; or comments)' };
  }
  if (!isSafePeekClause(orderBy)) {
    return { error: 'ORDER BY must be a sort list (no ; or comments)' };
  }

  let sql = baseSql.trim().replace(/;+\s*$/, '');
  if (where) {
    // Simple detection is enough: peek bases are SELECT * FROM … [WHERE …].
    if (/\bWHERE\b/i.test(sql)) {
      sql = `${sql} AND (${where})`;
    } else {
      sql = `${sql} WHERE (${where})`;
    }
  }
  if (orderBy) {
    if (/\bORDER\s+BY\b/i.test(sql)) {
      return { error: 'Base peek already has ORDER BY — clear it before adding one' };
    }
    sql = `${sql} ORDER BY ${orderBy}`;
  }
  return { sql, params: baseParams };
}
