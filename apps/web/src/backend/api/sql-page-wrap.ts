/**
 * Wrap a statement so the engine returns a page (LIMIT/OFFSET).
 * Fetches `limit + 1` rows so the caller can detect `hasNext` without a COUNT.
 */

export function clampOffset(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 1_000_000);
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

  if (d === 'sqlserver' || d === 'mssql') {
    // SQL Server requires ORDER BY for OFFSET/FETCH.
    return `SELECT * FROM (${inner}) AS _fox_page ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${fetchLimit} ROWS ONLY`;
  }
  if (d === 'oracle') {
    return `SELECT * FROM (${inner}) _fox_page OFFSET ${offset} ROWS FETCH NEXT ${fetchLimit} ROWS ONLY`;
  }
  if (d === 'db2') {
    return `SELECT * FROM (${inner}) AS _fox_page OFFSET ${offset} ROWS FETCH FIRST ${fetchLimit} ROWS ONLY`;
  }
  // Postgres, MySQL, MariaDB, SQLite, Cockroach, Yugabyte, TiDB, DuckDB, ClickHouse-ish
  return `SELECT * FROM (${inner}) AS _fox_page LIMIT ${fetchLimit} OFFSET ${offset}`;
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
