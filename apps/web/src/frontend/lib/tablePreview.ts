/**
 * Queries behind the schema-explorer data peek (Cmd/Ctrl-click a table).
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
