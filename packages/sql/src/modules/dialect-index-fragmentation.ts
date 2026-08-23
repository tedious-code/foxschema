/**
 * Dialect-aware index fragmentation probes for DBA guidance in Edit Table.
 *
 * Every registered dialect has a default probe (physical or estimated). Engines
 * without a native fragmentation metric still return index names with a null
 * percent so Refresh % / Utilities work everywhere; admins can paste custom SQL
 * that returns `index_name` + `fragmentation_percent` (+ optional `page_count`).
 *
 * Quality ladder:
 * - SQL Server / Azure SQL: physical % via dm_db_index_physical_stats
 * - PostgreSQL family: leaf_fragmentation via pgstatindex, from the pgstattuple
 *   extension. `pgstattuple` itself reports *table* statistics and has no
 *   leaf_fragmentation column — naming it here failed twice over: without the
 *   extension Postgres says the function does not exist, and with it installed
 *   the column does not exist either.
 * - MySQL family: table-level DATA_FREE ratio applied per index (estimate)
 * - DB2: empty-leaf ratio from SYSCAT.INDEXES (estimate)
 * - Oracle: weak estimate from ALL_INDEXES stats (prefer custom ANALYZE)
 * - SQLite / DuckDB / ClickHouse / Redshift: catalog listing + optional estimates
 */

import { isWriteStatement } from './sql-splitter.js';
import { quoteSqlIdentifier } from './sql-template.js';

export type IndexFragmentationMode = 'physical' | 'estimated' | 'unsupported';

export interface IndexFragmentationSupport {
  mode: IndexFragmentationMode;
  /** Engine has a built-in SELECT we can try first. */
  query: boolean;
  /** We can suggest REBUILD / REORG / OPTIMIZE / REINDEX SQL. */
  defrag: boolean;
  hint: string;
  /** Shape admins should return from custom SQL. */
  customSqlHint: string;
}

export interface IndexFragmentationQuery {
  sql: string;
  params: unknown[];
  mode: Exclude<IndexFragmentationMode, 'unsupported'>;
  /**
   * A second probe to try when the first fails because an optional server
   * feature is missing — Postgres `pgstatindex` needs the `pgstattuple`
   * extension, which most managed servers do not install by default.
   *
   * The fallback answers a strictly smaller question (no fragmentation
   * percent), but index list, size, and usage are what the panel is mostly
   * read for, and those need no extension. A dead panel is the worse answer.
   */
  fallback?: { sql: string; params: unknown[]; mode: Exclude<IndexFragmentationMode, 'unsupported'>; warning: string };
}

export interface IndexFragmentationRow {
  indexName: string;
  /** 0–100 when known; null when the engine could not compute a percent. */
  fragmentationPercent: number | null;
  pageCount?: number | null;
  /**
   * Last time the engine observed this index being used (ISO-8601), when the
   * dialect exposes it. Null means unknown or never (see `scanCount`).
   */
  lastUsed?: string | null;
  /**
   * User seeks/scans/lookups (SQL Server) or `idx_scan` (Postgres family).
   * Null when the dialect has no usage counter. `0` means never used.
   */
  scanCount?: number | null;
}

export type IndexFragmentationSeverity = 'ok' | 'warn' | 'critical' | 'unknown';

const CUSTOM_HINT =
  'Custom SQL must return columns index_name, fragmentation_percent (0–100), optional page_count, last_used, scan_count.';

const SUPPORT: Record<string, IndexFragmentationSupport> = {
  sqlserver: {
    mode: 'physical',
    query: true,
    defrag: true,
    hint: 'SQL Server: avg_fragmentation_in_percent from sys.dm_db_index_physical_stats (LIMITED); last used from dm_db_index_usage_stats.',
    customSqlHint: CUSTOM_HINT,
  },
  azuresql: {
    mode: 'physical',
    query: true,
    defrag: true,
    hint: 'Azure SQL: avg_fragmentation_in_percent from sys.dm_db_index_physical_stats (LIMITED); last used from dm_db_index_usage_stats.',
    customSqlHint: CUSTOM_HINT,
  },
  postgres: {
    mode: 'physical',
    query: true,
    defrag: true,
    hint: 'PostgreSQL: leaf_fragmentation via pgstatindex (pgstattuple extension). Last used from pg_stat_user_indexes.last_idx_scan on PG 16+; idx_scan on older servers.',
    customSqlHint: CUSTOM_HINT,
  },
  cockroachdb: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'CockroachDB: tries the pgstatindex probe; idx_scan when pg_stat_user_indexes is available.',
    customSqlHint: CUSTOM_HINT,
  },
  yugabytedb: {
    mode: 'physical',
    query: true,
    defrag: true,
    hint: 'YugabyteDB: tries the pgstatindex probe; idx_scan when pg_stat_user_indexes is available.',
    customSqlHint: CUSTOM_HINT,
  },
  mysql: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'MySQL: table-level DATA_FREE ratio (same estimate on each index). Scan count from performance_schema.table_io_waits_summary_by_index_usage (COUNT_READ since restart).',
    customSqlHint: CUSTOM_HINT,
  },
  mariadb: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'MariaDB: table-level DATA_FREE ratio (same estimate on each index). Usage from performance_schema, then information_schema.INDEX_STATISTICS (userstat).',
    customSqlHint: CUSTOM_HINT,
  },
  tidb: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'TiDB: table-level DATA_FREE-style estimate. Last used from INFORMATION_SCHEMA.TIDB_INDEX_USAGE (LAST_ACCESS_TIME, QUERY_TOTAL).',
    customSqlHint: CUSTOM_HINT,
  },
  db2: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'DB2: empty-leaf ratio from SYSCAT.INDEXES (estimate) plus LASTUSED. Use REORGCHK custom SQL for fuller guidance.',
    customSqlHint: CUSTOM_HINT,
  },
  oracle: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'Oracle: weak estimate from ALL_INDEXES. Last used from DBA_INDEX_USAGE (LAST_USED / TOTAL_ACCESS_COUNT); falls back to DBA_OBJECT_USAGE / V$OBJECT_USAGE.',
    customSqlHint: CUSTOM_HINT,
  },
  sqlite: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'SQLite: lists indexes (no native fragmentation % or last-used catalog). Use custom SQL / dbstat for page sizes; Defrag suggests REINDEX.',
    customSqlHint: CUSTOM_HINT,
  },
  duckdb: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'DuckDB: lists indexes from duckdb_indexes() (no native % or last-used catalog). Prefer custom SQL for ART / zone-map stats.',
    customSqlHint: CUSTOM_HINT,
  },
  clickhouse: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'ClickHouse: data-skipping indices from system.data_skipping_indices (no B-tree % or last-used catalog). OPTIMIZE TABLE for merges.',
    customSqlHint: CUSTOM_HINT,
  },
  redshift: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'Redshift: no secondary indexes — probe returns empty; use VACUUM / ANALYZE (custom SQL for unsorted %).',
    customSqlHint: CUSTOM_HINT,
  },
};

/** Unknown dialects still get a probe attempt via custom SQL templates. */
const DEFAULT_UNSUPPORTED: IndexFragmentationSupport = {
  mode: 'estimated',
  query: true,
  defrag: false,
  hint: 'Generic dialect: try the default listing probe, then paste custom SQL for a real %.',
  customSqlHint: CUSTOM_HINT,
};

/** Look up fragmentation support for a dialect id. */
export function dialectSupportsIndexFragmentation(
  dialectName: string
): IndexFragmentationSupport {
  return SUPPORT[dialectName.toLowerCase()] ?? DEFAULT_UNSUPPORTED;
}

/**
 * Split `schema.table` (or bare `table`) using an optional connection default schema.
 * Strips common quoting characters from each part.
 */
export function splitSchemaTable(
  tableName: string,
  defaultSchema?: string
): { schema: string; table: string } {
  const raw = tableName.trim();
  const strip = (p: string) => p.replace(/^["`\[\]]+|["`\[\]]+$/g, '');
  if (!raw) return { schema: (defaultSchema ?? '').trim(), table: '' };
  const parts = raw.split('.').map(strip).filter(Boolean);
  if (parts.length >= 2) {
    return { schema: parts[parts.length - 2]!, table: parts[parts.length - 1]! };
  }
  return { schema: (defaultSchema ?? '').trim(), table: parts[0] ?? '' };
}

/**
 * DBA-oriented bands (aligned with common SQL Server rebuild guidance):
 * <10 ok, 10–30 warn (reorganize), ≥30 critical (rebuild).
 */
export function fragmentationSeverity(
  pct: number | null | undefined
): IndexFragmentationSeverity {
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  if (pct < 10) return 'ok';
  if (pct < 30) return 'warn';
  return 'critical';
}

function q(name: string, dialect: string): string {
  return quoteSqlIdentifier(name, dialect);
}

/** Build the default fragmentation SELECT for a dialect, or an error if unsupported. */
export function buildIndexFragmentationQuery(opts: {
  dialect: string;
  schema?: string;
  table: string;
}): IndexFragmentationQuery | { error: string } {
  const dialect = opts.dialect.toLowerCase();
  const support = dialectSupportsIndexFragmentation(dialect);
  if (!support.query) {
    return { error: support.hint };
  }
  const { schema, table } = splitSchemaTable(opts.table, opts.schema);
  if (!table) return { error: 'Table name is required for index fragmentation.' };

  if (dialect === 'sqlserver' || dialect === 'azuresql') {
    const objectIdArg = schema ? `${schema}.${table}` : table;
    return {
      mode: 'physical',
      params: [objectIdArg],
      sql: `
SELECT
  i.name AS index_name,
  CAST(ps.avg_fragmentation_in_percent AS float) AS fragmentation_percent,
  CAST(ps.page_count AS bigint) AS page_count,
  (
    SELECT MAX(v)
    FROM (VALUES
      (us.last_user_seek),
      (us.last_user_scan),
      (us.last_user_lookup),
      (us.last_user_update)
    ) AS t(v)
  ) AS last_used,
  CAST(ISNULL(us.user_seeks, 0) + ISNULL(us.user_scans, 0) + ISNULL(us.user_lookups, 0) AS bigint) AS scan_count
FROM sys.dm_db_index_physical_stats(DB_ID(), OBJECT_ID(@p0), NULL, NULL, 'LIMITED') AS ps
INNER JOIN sys.indexes AS i
  ON ps.object_id = i.object_id AND ps.index_id = i.index_id
LEFT JOIN sys.dm_db_index_usage_stats AS us
  ON us.database_id = DB_ID()
 AND us.object_id = i.object_id
 AND us.index_id = i.index_id
WHERE i.name IS NOT NULL
  AND ps.index_level = 0
ORDER BY i.name
`.trim(),
    };
  }

  if (dialect === 'postgres' || dialect === 'cockroachdb' || dialect === 'yugabytedb') {
    const sch = schema || 'public';
    return {
      mode: dialect === 'cockroachdb' ? 'estimated' : 'physical',
      params: [sch, table],
      sql: `
SELECT
  ci.relname AS index_name,
  -- pgstatindex reports NaN for an index with no leaf pages yet; that is
  -- "nothing measured", not a number, and "NaN%" in the grid reads as a bug.
  NULLIF((SELECT leaf_fragmentation FROM pgstatindex(ci.oid::regclass)), 'NaN'::float8) AS fragmentation_percent,
  NULL::bigint AS page_count,
  -- last_idx_scan exists only on PostgreSQL 16+; keep last_used NULL so older
  -- servers (and Cockroach / Yugabyte) still run this probe. idx_scan is the usage signal.
  NULL::timestamptz AS last_used,
  COALESCE(psi.idx_scan, 0)::bigint AS scan_count
FROM pg_index ix
JOIN pg_class ct ON ct.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = ct.relnamespace
JOIN pg_class ci ON ci.oid = ix.indexrelid
LEFT JOIN pg_stat_user_indexes psi ON psi.indexrelid = ci.oid
WHERE n.nspname = $1
  AND ct.relname = $2
ORDER BY ci.relname
`.trim(),
      // pgstatindex lives in the pgstattuple extension, which most servers do
      // not install. Without it there is no fragmentation percent to report —
      // but the index list, its size, and whether anything has ever used it
      // need nothing but the core catalogs, and that is most of the panel.
      fallback: {
        mode: 'estimated',
        params: [sch, table],
        warning:
          'Fragmentation needs the pgstattuple extension (CREATE EXTENSION pgstattuple). Showing index size and usage only.',
        sql: `
SELECT
  ci.relname AS index_name,
  NULL::float8 AS fragmentation_percent,
  ci.relpages::bigint AS page_count,
  NULL::timestamptz AS last_used,
  COALESCE(psi.idx_scan, 0)::bigint AS scan_count
FROM pg_index ix
JOIN pg_class ct ON ct.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = ct.relnamespace
JOIN pg_class ci ON ci.oid = ix.indexrelid
LEFT JOIN pg_stat_user_indexes psi ON psi.indexrelid = ci.oid
WHERE n.nspname = $1
  AND ct.relname = $2
ORDER BY ci.relname
`.trim(),
      },
    };
  }

  if (dialect === 'mysql' || dialect === 'mariadb' || dialect === 'tidb') {
    if (!schema) {
      return { error: 'MySQL-family fragmentation probe needs a schema (database) name.' };
    }
    return {
      mode: 'estimated',
      params: [schema, table],
      sql: `
SELECT
  s.INDEX_NAME AS index_name,
  CASE
    WHEN (IFNULL(t.DATA_LENGTH, 0) + IFNULL(t.INDEX_LENGTH, 0)) = 0 THEN NULL
    ELSE ROUND(
      100 * IFNULL(t.DATA_FREE, 0) / (IFNULL(t.DATA_LENGTH, 0) + IFNULL(t.INDEX_LENGTH, 0)),
      2
    )
  END AS fragmentation_percent,
  NULL AS page_count,
  NULL AS last_used,
  NULL AS scan_count
FROM information_schema.STATISTICS s
JOIN information_schema.TABLES t
  ON t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_NAME = s.TABLE_NAME
WHERE s.TABLE_SCHEMA = ?
  AND s.TABLE_NAME = ?
GROUP BY s.INDEX_NAME, t.DATA_FREE, t.DATA_LENGTH, t.INDEX_LENGTH
ORDER BY s.INDEX_NAME
`.trim(),
    };
  }

  if (dialect === 'db2') {
    if (!schema) {
      return { error: 'DB2 fragmentation probe needs a schema name.' };
    }
    return {
      mode: 'estimated',
      params: [schema.toUpperCase(), table.toUpperCase()],
      sql: `
SELECT
  INDNAME AS index_name,
  CASE
    WHEN NLEAF IS NULL OR NLEAF = 0 THEN NULL
    ELSE DECIMAL(100.0 * FLOAT(COALESCE(NUM_EMPTY_LEAFS, 0)) / FLOAT(NLEAF), 5, 2)
  END AS fragmentation_percent,
  NLEAF AS page_count,
  CASE
    WHEN LASTUSED IS NULL OR LASTUSED <= DATE('1971-01-01') THEN NULL
    ELSE LASTUSED
  END AS last_used,
  CAST(NULL AS BIGINT) AS scan_count
FROM SYSCAT.INDEXES
WHERE TABSCHEMA = ?
  AND TABNAME = ?
ORDER BY INDNAME
`.trim(),
    };
  }

  if (dialect === 'oracle') {
    if (!schema) {
      return { error: 'Oracle fragmentation probe needs a schema (owner) name.' };
    }
    return {
      mode: 'estimated',
      params: [schema.toUpperCase(), table.toUpperCase()],
      sql: `
SELECT
  INDEX_NAME AS index_name,
  CASE
    WHEN LEAF_BLOCKS IS NULL OR LEAF_BLOCKS = 0 OR NUM_ROWS IS NULL OR NUM_ROWS = 0 THEN NULL
    ELSE ROUND(
      GREATEST(0, LEAST(100, 100 * (1 - (DISTINCT_KEYS / NULLIF(NUM_ROWS, 0))))),
      2
    )
  END AS fragmentation_percent,
  LEAF_BLOCKS AS page_count,
  CAST(NULL AS TIMESTAMP) AS last_used,
  CAST(NULL AS NUMBER) AS scan_count
FROM ALL_INDEXES
WHERE OWNER = :1
  AND TABLE_NAME = :2
ORDER BY INDEX_NAME
`.trim(),
    };
  }

  if (dialect === 'sqlite') {
    // SQLite has no native fragmentation %; list indexes so Refresh % works.
    // Custom SQL / dbstat can add page_count when the VTAB is compiled in.
    return {
      mode: 'estimated',
      params: [table],
      sql: `
SELECT
  name AS index_name,
  CAST(NULL AS REAL) AS fragmentation_percent,
  CAST(NULL AS INTEGER) AS page_count,
  CAST(NULL AS TEXT) AS last_used,
  CAST(NULL AS INTEGER) AS scan_count
FROM sqlite_master
WHERE type = 'index'
  AND tbl_name = ?
  AND IFNULL(name, '') NOT LIKE 'sqlite_%'
ORDER BY name
`.trim(),
    };
  }

  if (dialect === 'duckdb') {
    return {
      mode: 'estimated',
      params: schema ? [table, schema] : [table],
      sql: schema
        ? `
SELECT
  index_name AS index_name,
  CAST(NULL AS DOUBLE) AS fragmentation_percent,
  CAST(NULL AS BIGINT) AS page_count,
  CAST(NULL AS TIMESTAMP) AS last_used,
  CAST(NULL AS BIGINT) AS scan_count
FROM duckdb_indexes()
WHERE table_name = ?
  AND schema_name = ?
ORDER BY index_name
`.trim()
        : `
SELECT
  index_name AS index_name,
  CAST(NULL AS DOUBLE) AS fragmentation_percent,
  CAST(NULL AS BIGINT) AS page_count,
  CAST(NULL AS TIMESTAMP) AS last_used,
  CAST(NULL AS BIGINT) AS scan_count
FROM duckdb_indexes()
WHERE table_name = ?
ORDER BY index_name
`.trim(),
    };
  }

  if (dialect === 'clickhouse') {
    const db = schema || 'default';
    return {
      mode: 'estimated',
      params: [db, table],
      sql: `
SELECT
  name AS index_name,
  CAST(NULL AS Float64) AS fragmentation_percent,
  CAST(NULL AS UInt64) AS page_count,
  CAST(NULL AS DateTime) AS last_used,
  CAST(NULL AS UInt64) AS scan_count
FROM system.data_skipping_indices
WHERE database = ?
  AND table = ?
ORDER BY name
`.trim(),
    };
  }

  if (dialect === 'redshift') {
    // Redshift has no secondary indexes; return an empty typed result set so
    // Refresh % succeeds and the UI can show custom VACUUM / unsorted probes.
    return {
      mode: 'estimated',
      params: [],
      sql: `
SELECT
  CAST(NULL AS VARCHAR(128)) AS index_name,
  CAST(NULL AS FLOAT) AS fragmentation_percent,
  CAST(NULL AS BIGINT) AS page_count,
  CAST(NULL AS TIMESTAMP) AS last_used,
  CAST(NULL AS BIGINT) AS scan_count
WHERE 1 = 0
`.trim(),
    };
  }

  // Generic fallback: empty typed result — custom SQL still available.
  return {
    mode: 'estimated',
    params: [],
    sql: `SELECT CAST(NULL AS VARCHAR(128)) AS index_name, CAST(NULL AS FLOAT) AS fragmentation_percent, CAST(NULL AS TIMESTAMP) AS last_used, CAST(NULL AS BIGINT) AS scan_count WHERE 1 = 0`,
  };
}

export type IndexUsageQuery = { sql: string; params: unknown[] };

function mysqlFamilyIndexIoUsageSql(): string {
  return `
SELECT INDEX_NAME AS index_name,
       CAST(NULL AS DATETIME) AS last_used,
       COUNT_READ AS scan_count
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE OBJECT_SCHEMA = ?
  AND OBJECT_NAME = ?
  AND INDEX_NAME IS NOT NULL
`.trim();
}

function postgresLastIdxScanSql(): string {
  return `
SELECT
  ci.relname AS index_name,
  psi.last_idx_scan AS last_used,
  COALESCE(psi.idx_scan, 0)::bigint AS scan_count
FROM pg_index ix
JOIN pg_class ct ON ct.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = ct.relnamespace
JOIN pg_class ci ON ci.oid = ix.indexrelid
LEFT JOIN pg_stat_user_indexes psi ON psi.indexrelid = ci.oid
WHERE n.nspname = $1
  AND ct.relname = $2
`.trim();
}

/**
 * Extra SELECTs that fill `last_used` / `scan_count` from dialect usage catalogs.
 * Tried in order until one succeeds — a missing view or missing grant must not
 * fail the fragmentation probe (Oracle DBA_INDEX_USAGE is a common example).
 *
 * SQL Server / Azure SQL / DB2 already join usage into the main probe, so they
 * return an empty list here.
 */
export function buildIndexUsageQueries(opts: {
  dialect: string;
  schema?: string;
  table: string;
}): IndexUsageQuery[] {
  const dialect = opts.dialect.toLowerCase();
  const { schema, table } = splitSchemaTable(opts.table, opts.schema);
  if (!table) return [];

  if (dialect === 'oracle') {
    if (!schema) return [];
    const owner = schema.toUpperCase();
    const tbl = table.toUpperCase();
    return [
      {
        params: [owner, tbl],
        sql: `
SELECT
  i.INDEX_NAME AS index_name,
  u.LAST_USED AS last_used,
  COALESCE(u.TOTAL_ACCESS_COUNT, 0) AS scan_count
FROM ALL_INDEXES i
LEFT JOIN DBA_INDEX_USAGE u
  ON u.OWNER = i.OWNER AND u.NAME = i.INDEX_NAME
WHERE i.OWNER = :1
  AND i.TABLE_NAME = :2
`.trim(),
      },
      {
        params: [owner, tbl],
        sql: `
SELECT
  INDEX_NAME AS index_name,
  CAST(NULL AS TIMESTAMP) AS last_used,
  CASE WHEN USED = 'YES' THEN 1 ELSE 0 END AS scan_count
FROM DBA_OBJECT_USAGE
WHERE OWNER = :1
  AND TABLE_NAME = :2
`.trim(),
      },
      {
        params: [tbl],
        sql: `
SELECT
  INDEX_NAME AS index_name,
  CAST(NULL AS TIMESTAMP) AS last_used,
  CASE WHEN USED = 'YES' THEN 1 ELSE 0 END AS scan_count
FROM V$OBJECT_USAGE
WHERE TABLE_NAME = :1
`.trim(),
      },
    ];
  }

  if (dialect === 'tidb') {
    if (!schema) return [];
    return [
      {
        params: [schema, table],
        sql: `
SELECT INDEX_NAME AS index_name,
       LAST_ACCESS_TIME AS last_used,
       QUERY_TOTAL AS scan_count
FROM INFORMATION_SCHEMA.CLUSTER_TIDB_INDEX_USAGE
WHERE TABLE_SCHEMA = ?
  AND TABLE_NAME = ?
`.trim(),
      },
      {
        params: [schema, table],
        sql: `
SELECT INDEX_NAME AS index_name,
       LAST_ACCESS_TIME AS last_used,
       QUERY_TOTAL AS scan_count
FROM INFORMATION_SCHEMA.TIDB_INDEX_USAGE
WHERE TABLE_SCHEMA = ?
  AND TABLE_NAME = ?
`.trim(),
      },
      { params: [schema, table], sql: mysqlFamilyIndexIoUsageSql() },
    ];
  }

  if (dialect === 'mysql') {
    if (!schema) return [];
    return [{ params: [schema, table], sql: mysqlFamilyIndexIoUsageSql() }];
  }

  if (dialect === 'mariadb') {
    if (!schema) return [];
    return [
      { params: [schema, table], sql: mysqlFamilyIndexIoUsageSql() },
      {
        params: [schema, table],
        sql: `
SELECT INDEX_NAME AS index_name,
       CAST(NULL AS DATETIME) AS last_used,
       ROWS_READ AS scan_count
FROM information_schema.INDEX_STATISTICS
WHERE TABLE_SCHEMA = ?
  AND TABLE_NAME = ?
`.trim(),
      },
    ];
  }

  if (dialect === 'postgres' || dialect === 'cockroachdb' || dialect === 'yugabytedb') {
    const sch = schema || 'public';
    return [{ params: [sch, table], sql: postgresLastIdxScanSql() }];
  }

  return [];
}

/** Overlay usage-catalog rows onto fragmentation rows, matched by index name. */
export function mergeIndexUsageRows(
  rows: IndexFragmentationRow[],
  usage: ReadonlyArray<IndexFragmentationRow>
): IndexFragmentationRow[] {
  if (usage.length === 0) return rows;
  const byName = new Map<string, IndexFragmentationRow>();
  for (const u of usage) {
    byName.set(u.indexName.toLowerCase(), u);
  }
  return rows.map((row) => {
    const u = byName.get(row.indexName.toLowerCase());
    if (!u) return row;
    return {
      ...row,
      lastUsed: row.lastUsed ?? u.lastUsed ?? null,
      scanCount: row.scanCount ?? u.scanCount ?? null,
    };
  });
}

function pickField(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return row[key];
    const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found) return row[found];
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Driver timestamps (Date, ISO string, dialect DATE) → ISO-8601, or null when
 * missing / the engine's "never used" sentinel (year before 1971, e.g. DB2 0001-01-01).
 */
export function normalizeIndexLastUsed(value: unknown): string | null {
  if (value == null || value === '') return null;
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value > 1e12 ? value : value * 1000);
  } else if (typeof value === 'string') {
    const t = value.trim();
    if (!t || /^0+1[-/]0*1[-/]0*1/.test(t)) return null;
    const parsed = new Date(t);
    date = Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (!date || !Number.isFinite(date.getTime())) return null;
  if (date.getUTCFullYear() < 1971) return null;
  return date.toISOString();
}

/** Normalize driver rows (any casing) into IndexFragmentationRow[]. */
export function normalizeIndexFragmentationRows(
  rows: ReadonlyArray<Record<string, unknown>>
): IndexFragmentationRow[] {
  const out: IndexFragmentationRow[] = [];
  for (const row of rows) {
    const nameRaw = pickField(row, [
      'index_name',
      'indexname',
      'indname',
      'name',
      'INDEX_NAME',
    ]);
    const indexName = nameRaw == null ? '' : String(nameRaw).trim();
    if (!indexName) continue;
    let pct = asFiniteNumber(
      pickField(row, [
        'fragmentation_percent',
        'fragmentationpercent',
        'avg_fragmentation_in_percent',
        'leaf_fragmentation',
        'frag_pct',
        'pct',
      ])
    );
    if (pct != null) {
      if (pct < 0) pct = 0;
      if (pct > 100) pct = 100;
    }
    const pageCount = asFiniteNumber(
      pickField(row, ['page_count', 'pagecount', 'nleaf', 'leaf_blocks'])
    );
    const lastUsed = normalizeIndexLastUsed(
      pickField(row, [
        'last_used',
        'lastused',
        'last_idx_scan',
        'last_access_time',
        'last_used_at',
        'lastusedate',
      ])
    );
    const scanCount = asFiniteNumber(
      pickField(row, [
        'scan_count',
        'scancount',
        'idx_scan',
        'user_seeks',
        'query_total',
        'total_access_count',
        'count_read',
        'count_star',
        'rows_read',
      ])
    );
    out.push({
      indexName,
      fragmentationPercent: pct,
      pageCount,
      lastUsed,
      scanCount,
    });
  }
  return out;
}

/**
 * What this engine calls the operation, for buttons and confirmations.
 *
 * "Defragment" is SQL Server's word. Postgres reindexes, MySQL optimises, Db2
 * reorgs — and the SQL emitted below has always been dialect-correct, so the
 * label was the only part still speaking one engine's language to all of them.
 * A reader who knows their own database should recognise the verb on the
 * button as the one they would have typed.
 */
export function indexMaintenanceVerb(dialect: string): string {
  switch ((dialect || '').toLowerCase()) {
    case 'postgres':
    case 'cockroachdb':
    case 'yugabytedb':
    case 'redshift':
    case 'sqlite':
      return 'Reindex';
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return 'Optimize';
    case 'db2':
      return 'Reorg';
    case 'sqlserver':
    case 'azuresql':
    case 'oracle':
      return 'Rebuild';
    default:
      // Nothing engine-specific to promise, so describe the intent instead.
      return 'Rebuild';
  }
}

/**
 * Suggest maintenance SQL for one index. Uses Microsoft-style bands when the
 * engine supports REBUILD vs REORGANIZE; otherwise a single dialect action.
 */
export function buildIndexDefragSql(opts: {
  dialect: string;
  schema?: string;
  table: string;
  indexName: string;
  fragmentationPercent?: number | null;
}): string[] {
  const dialect = opts.dialect.toLowerCase();
  const support = dialectSupportsIndexFragmentation(dialect);
  if (!support.defrag) return [];
  const { schema, table } = splitSchemaTable(opts.table, opts.schema);
  if (!table || !opts.indexName.trim()) return [];
  const idx = opts.indexName.trim();
  const pct = opts.fragmentationPercent;
  const qTable = schema ? `${q(schema, dialect)}.${q(table, dialect)}` : q(table, dialect);
  const qIndex = q(idx, dialect);
  const qIndexQualified = schema ? `${q(schema, dialect)}.${qIndex}` : qIndex;

  if (dialect === 'sqlserver' || dialect === 'azuresql') {
    if (pct != null && pct < 30) {
      return [`ALTER INDEX ${qIndex} ON ${qTable} REORGANIZE;`];
    }
    return [`ALTER INDEX ${qIndex} ON ${qTable} REBUILD;`];
  }

  if (dialect === 'postgres' || dialect === 'cockroachdb' || dialect === 'yugabytedb') {
    // CONCURRENTLY avoids long locks on Postgres; Cockroach may ignore/reject it.
    if (dialect === 'postgres' || dialect === 'yugabytedb') {
      return [`REINDEX INDEX CONCURRENTLY ${qIndexQualified};`];
    }
    return [`REINDEX INDEX ${qIndexQualified};`];
  }

  if (dialect === 'mysql' || dialect === 'mariadb' || dialect === 'tidb') {
    return [`OPTIMIZE TABLE ${qTable};`];
  }

  if (dialect === 'db2') {
    return [
      `REORG INDEX ${qIndexQualified};`,
      `-- Or all indexes: REORG INDEXES ALL FOR TABLE ${qTable};`,
    ];
  }

  if (dialect === 'oracle') {
    return [`ALTER INDEX ${qIndexQualified} REBUILD;`];
  }

  if (dialect === 'sqlite') {
    return [`REINDEX ${qIndex};`, `-- Or whole DB: VACUUM;`];
  }

  if (dialect === 'duckdb') {
    return [`CHECKPOINT;`];
  }

  if (dialect === 'clickhouse') {
    return [`OPTIMIZE TABLE ${qTable} FINAL;`];
  }

  if (dialect === 'redshift') {
    return [
      `VACUUM ${qTable};`,
      `ANALYZE ${qTable};`,
    ];
  }

  return [];
}

/**
 * Quoted DROP INDEX (or dialect equivalent) for Utilities → Index Management.
 * Returns empty when the name/table is missing, the dialect has no secondary
 * indexes (Redshift), or the index backs a UNIQUE/PK constraint — those must
 * be dropped from Edit table as constraints, not with DROP INDEX.
 */
export function buildIndexDropSql(opts: {
  dialect: string;
  schema?: string;
  table: string;
  indexName: string;
  constraint?: boolean;
}): string[] {
  const dialect = opts.dialect.toLowerCase();
  if (opts.constraint) return [];
  if (dialect === 'redshift') return [];
  const { schema, table } = splitSchemaTable(opts.table, opts.schema);
  if (!table || !opts.indexName.trim()) return [];
  const idx = opts.indexName.trim();
  const qTable = schema ? `${q(schema, dialect)}.${q(table, dialect)}` : q(table, dialect);
  const qIndex = q(idx, dialect);
  const qIndexQualified = schema ? `${q(schema, dialect)}.${qIndex}` : qIndex;

  if (dialect === 'sqlserver' || dialect === 'azuresql') {
    return [`DROP INDEX ${qIndex} ON ${qTable};`];
  }
  if (dialect === 'mysql' || dialect === 'mariadb' || dialect === 'tidb') {
    return [`DROP INDEX ${qIndex} ON ${qTable};`];
  }
  if (dialect === 'postgres' || dialect === 'cockroachdb' || dialect === 'yugabytedb') {
    return [`DROP INDEX IF EXISTS ${qIndexQualified};`];
  }
  if (dialect === 'db2' || dialect === 'oracle') {
    return [`DROP INDEX ${qIndexQualified};`];
  }
  if (dialect === 'sqlite') {
    return [`DROP INDEX IF EXISTS ${qIndex};`];
  }
  if (dialect === 'duckdb') {
    return [`DROP INDEX IF EXISTS ${qIndexQualified};`];
  }
  if (dialect === 'clickhouse') {
    // Data-skipping indexes listed in Index Management, not traditional B-trees.
    return [`ALTER TABLE ${qTable} DROP INDEX ${qIndex};`];
  }
  return [`DROP INDEX ${qIndexQualified};`];
}

/** Example custom SELECT admins can paste when the default probe fails. */
export function buildIndexFragmentationCustomTemplate(opts: {
  dialect: string;
  schema?: string;
  table: string;
}): string {
  const dialect = opts.dialect.toLowerCase();
  const { schema, table } = splitSchemaTable(opts.table, opts.schema);
  const sch = schema || 'schema';
  const tbl = table || 'table';

  if (dialect === 'sqlserver' || dialect === 'azuresql') {
    return `-- Custom fragmentation probe (must return index_name, fragmentation_percent)
SELECT i.name AS index_name,
       CAST(ps.avg_fragmentation_in_percent AS float) AS fragmentation_percent,
       CAST(ps.page_count AS bigint) AS page_count,
       (SELECT MAX(v) FROM (VALUES (us.last_user_seek),(us.last_user_scan),(us.last_user_lookup),(us.last_user_update)) AS t(v)) AS last_used,
       CAST(ISNULL(us.user_seeks,0)+ISNULL(us.user_scans,0)+ISNULL(us.user_lookups,0) AS bigint) AS scan_count
FROM sys.dm_db_index_physical_stats(DB_ID(), OBJECT_ID(N'${sch}.${tbl}'), NULL, NULL, 'DETAILED') ps
JOIN sys.indexes i ON ps.object_id = i.object_id AND ps.index_id = i.index_id
LEFT JOIN sys.dm_db_index_usage_stats us
  ON us.database_id = DB_ID() AND us.object_id = i.object_id AND us.index_id = i.index_id
WHERE i.name IS NOT NULL AND ps.index_level = 0;`;
  }

  if (dialect === 'postgres' || dialect === 'cockroachdb' || dialect === 'yugabytedb') {
    return `-- Requires: CREATE EXTENSION IF NOT EXISTS pgstattuple;
SELECT ci.relname AS index_name,
       (pgstatindex(ci.oid::regclass)).leaf_fragmentation AS fragmentation_percent,
       psi.last_idx_scan AS last_used,
       COALESCE(psi.idx_scan, 0)::bigint AS scan_count
FROM pg_index ix
JOIN pg_class ct ON ct.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = ct.relnamespace
JOIN pg_class ci ON ci.oid = ix.indexrelid
LEFT JOIN pg_stat_user_indexes psi ON psi.indexrelid = ci.oid
WHERE n.nspname = '${sch}' AND ct.relname = '${tbl}';`;
  }

  if (dialect === 'tidb') {
    return `SELECT INDEX_NAME AS index_name, NULL AS fragmentation_percent,
       LAST_ACCESS_TIME AS last_used, QUERY_TOTAL AS scan_count
FROM INFORMATION_SCHEMA.TIDB_INDEX_USAGE
WHERE TABLE_SCHEMA = '${sch}' AND TABLE_NAME = '${tbl}';`;
  }

  if (dialect === 'mysql' || dialect === 'mariadb') {
    return `SELECT INDEX_NAME AS index_name, NULL AS fragmentation_percent,
       CAST(NULL AS DATETIME) AS last_used, COUNT_READ AS scan_count
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE OBJECT_SCHEMA = '${sch}' AND OBJECT_NAME = '${tbl}'
  AND INDEX_NAME IS NOT NULL;`;
  }

  if (dialect === 'db2') {
    return `SELECT INDNAME AS index_name,
       DECIMAL(100.0 * FLOAT(COALESCE(NUM_EMPTY_LEAFS,0)) / NULLIF(FLOAT(NLEAF),0), 5, 2)
         AS fragmentation_percent,
       CASE WHEN LASTUSED IS NULL OR LASTUSED <= DATE('1971-01-01') THEN NULL ELSE LASTUSED END AS last_used
FROM SYSCAT.INDEXES
WHERE TABSCHEMA = '${sch.toUpperCase()}' AND TABNAME = '${tbl.toUpperCase()}';`;
  }

  if (dialect === 'oracle') {
    return `-- Last used: DBA_INDEX_USAGE (12.2+). Fragmentation: ANALYZE INDEX … VALIDATE STRUCTURE.
SELECT i.INDEX_NAME AS index_name,
       CAST(NULL AS NUMBER) AS fragmentation_percent,
       u.LAST_USED AS last_used,
       COALESCE(u.TOTAL_ACCESS_COUNT, 0) AS scan_count
FROM ALL_INDEXES i
LEFT JOIN DBA_INDEX_USAGE u ON u.OWNER = i.OWNER AND u.NAME = i.INDEX_NAME
WHERE i.OWNER = '${sch.toUpperCase()}' AND i.TABLE_NAME = '${tbl.toUpperCase()}';`;
  }

  if (dialect === 'sqlite') {
    return `-- Optional: page sizes via dbstat (SQLITE_ENABLE_DBSTAT_VTAB)
SELECT m.name AS index_name,
       CAST(NULL AS REAL) AS fragmentation_percent,
       (SELECT SUM(pgsize) FROM dbstat d WHERE d.name = m.name) AS page_count
FROM sqlite_master m
WHERE m.type = 'index' AND m.tbl_name = '${tbl}' AND m.name NOT LIKE 'sqlite_%';`;
  }

  if (dialect === 'duckdb') {
    return `SELECT index_name AS index_name,
       CAST(NULL AS DOUBLE) AS fragmentation_percent
FROM duckdb_indexes()
WHERE table_name = '${tbl}'${
      schema ? ` AND schema_name = '${sch}'` : ''
    };`;
  }

  if (dialect === 'clickhouse') {
    return `SELECT name AS index_name,
       CAST(NULL AS Float64) AS fragmentation_percent
FROM system.data_skipping_indices
WHERE database = '${sch}' AND table = '${tbl}';`;
  }

  if (dialect === 'redshift') {
    return `-- Redshift has no secondary indexes; unsorted block % example:
SELECT 'unsorted' AS index_name,
       CAST(unsorted AS float) AS fragmentation_percent
FROM svv_table_info
WHERE schema = '${sch}' AND "table" = '${tbl}';`;
  }

  return `SELECT 'idx_name' AS index_name, 0 AS fragmentation_percent;`;
}

/**
 * Reject obviously unsafe custom probes on the stats endpoint.
 * Same trust model as the SQL editor for SELECTs, but refuse writes / multi-statements
 * — including PostgreSQL data-modifying CTEs that still end in SELECT.
 */
export function isSafeIndexFragmentationCustomSql(sql: string): true | string {
  const t = sql.trim();
  if (!t) return 'Custom SQL is empty.';
  if (t.length > 20_000) return 'Custom SQL is too long.';
  if (/;/.test(t.replace(/;+\s*$/, ''))) {
    return 'Custom SQL must be a single statement (no extra semicolons).';
  }
  if (/--/.test(t) || /\/\*|\*\//.test(t)) {
    // Allow leading comment block templates — strip line comments for verb check only.
  }
  const stripped = t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (!/^(with|select)\b/i.test(stripped)) {
    return 'Custom SQL must be a SELECT (or WITH … SELECT) statement.';
  }
  // `WITH x AS (DELETE … RETURNING …) SELECT …` starts with WITH/SELECT but writes.
  if (isWriteStatement(stripped)) {
    return 'Custom SQL must be read-only (no INSERT/UPDATE/DELETE/DDL, including in CTEs).';
  }
  return true;
}
