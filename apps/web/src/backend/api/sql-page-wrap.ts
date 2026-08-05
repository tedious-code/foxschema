/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wrap a statement so the engine returns a page (LIMIT/OFFSET).
 * Fetches `limit + 1` rows so the caller can detect `hasNext` without a COUNT.
 *
 * Alias must not start with `_` — DB2 treats `_…` as a conditional-compilation
 * directive (SQL20521N). Keep a plain letter-led name for all dialects.
 */

import { statementVerb } from '@foxschema/db';

/** Verbs that can appear as a subquery in `SELECT * FROM (…)` for paging. */
const PAGEABLE_VERBS = new Set(['select', 'values']);

/** Dialects that use T-SQL OFFSET/FETCH (not MySQL/Postgres LIMIT). */
const TSQL_DIALECTS = new Set(['sqlserver', 'mssql', 'azuresql']);

/** Derived-table alias for page wraps (no leading underscore — see file header). */
const PAGE_ALIAS = 'fox_page';

export function clampOffset(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 1_000_000);
}

/**
 * True when the statement is safe to wrap for OFFSET/LIMIT paging
 * (SELECT / VALUES, including `WITH … AS (…) SELECT …`).
 * Writes, DDL, SET, SHOW, EXPLAIN, CALL, etc. are not pageable.
 */
export function isPageableStatement(sql: string): boolean {
  const verb = statementVerb(sql);
  return verb !== null && PAGEABLE_VERBS.has(verb);
}

/**
 * True when `sql` has a top-level `ORDER BY` (paren depth 0), ignoring
 * strings and comments. Used so T-SQL paging can append OFFSET/FETCH to the
 * original statement instead of nesting it in a derived table (SQL Server
 * rejects `ORDER BY` in a subquery without TOP/OFFSET).
 */
export function hasTopLevelOrderBy(sql: string): boolean {
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1] ?? '';

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < n && sql[i] !== ']') i++;
      i = Math.min(n, i + 1);
      continue;
    }

    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0 && (ch === 'o' || ch === 'O')) {
      // Word-boundary ORDER BY at top level.
      if (/\border\s+by\b/i.test(sql.slice(i, i + 16))) {
        const before = i === 0 ? ' ' : sql[i - 1]!;
        if (!/[A-Za-z0-9_]/.test(before)) return true;
      }
    }
    i++;
  }
  return false;
}

/**
 * Best-effort page wrap. Dialects without OFFSET still get a subquery + LIMIT
 * when offset is 0; non-zero offset uses the closest dialect syntax.
 */
export function wrapSqlForPage(
  sql: string,
  dialect: string,
  offset: number,
  limit: number
): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  const d = dialect.toLowerCase();
  const inner = trimmed;
  const fetchLimit = limit + 1; // +1 probe row

  if (TSQL_DIALECTS.has(d)) {
    // SQL Server / Azure SQL require ORDER BY for OFFSET/FETCH.
    // Prefer appending to a top-level ORDER BY so paging stays stable and the
    // engine accepts the statement (ORDER BY inside a bare derived table is illegal).
    const fetch = `OFFSET ${offset} ROWS FETCH NEXT ${fetchLimit} ROWS ONLY`;
    if (hasTopLevelOrderBy(inner)) {
      return `${inner} ${fetch}`;
    }
    return `SELECT * FROM (${inner}) AS ${PAGE_ALIAS} ORDER BY (SELECT NULL) ${fetch}`;
  }
  if (d === 'oracle') {
    return `SELECT * FROM (${inner}) ${PAGE_ALIAS} OFFSET ${offset} ROWS FETCH NEXT ${fetchLimit} ROWS ONLY`;
  }
  if (d === 'db2') {
    return `SELECT * FROM (${inner}) AS ${PAGE_ALIAS} OFFSET ${offset} ROWS FETCH FIRST ${fetchLimit} ROWS ONLY`;
  }
  // Postgres, MySQL, MariaDB, SQLite, Cockroach, Yugabyte, TiDB, DuckDB, ClickHouse-ish
  return `SELECT * FROM (${inner}) AS ${PAGE_ALIAS} LIMIT ${fetchLimit} OFFSET ${offset}`;
}

/** After shaping, drop the probe row and set truncated/hasNext. */
export function trimPageProbe<T extends { rows: unknown[][]; rowCount: number; truncated: boolean }>(
  shaped: T,
  pageSize: number
): T & { hasNext: boolean } {
  const hasNext = shaped.rows.length > pageSize;
  const rows = hasNext ? shaped.rows.slice(0, pageSize) : shaped.rows;
  return {
    ...shaped,
    rows,
    rowCount: rows.length,
    truncated: hasNext || shaped.truncated,
    hasNext,
  };
}
