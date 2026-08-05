/**
 * Central dialect × index-feature bitmatrix used by generators and the
 * table blueprint UI.
 *
 * Notes (verified against FoxSchema dialect registry + vendor docs):
 * - Traditional engines (Postgres family, MySQL/MariaDB/TiDB, SQL Server,
 *   Oracle, DB2, SQLite, DuckDB) support CREATE/DROP INDEX, UNIQUE indexes,
 *   and non-unique indexes (accept duplicates).
 * - ASC/DESC per index column is supported on those same engines (syntax
 *   accepted; MySQL 8+ honors DESC for InnoDB).
 * - Filtered / partial indexes (`CREATE INDEX … WHERE predicate`):
 *     yes — Postgres, Cockroach, Yugabyte, SQL Server, Azure SQL, SQLite
 *     no  — MySQL/MariaDB/TiDB, Oracle, DB2, DuckDB (no WHERE on CREATE INDEX)
 * - ClickHouse: no traditional secondary indexes (data-skipping indexes use
 *   a different DDL shape — treat as unsupported in the blueprint).
 * - Redshift: no CREATE INDEX / DROP INDEX for secondary indexes (sort/dist
 *   keys only) — treat as unsupported despite a leftover Postgres-like drop
 *   helper on the dialect object.
 */

export type IndexFeatureSupport = {
  /** `CREATE [UNIQUE] INDEX … ON table (cols…)` */
  create: boolean;
  /** `DROP INDEX …` (dialect-specific ON table / IF EXISTS) */
  drop: boolean;
  /** UNIQUE indexes / unique constraints that reject duplicates */
  unique: boolean;
  /** Non-unique indexes that accept duplicate key values */
  acceptDuplicates: boolean;
  /** Per-column ASC / DESC in the index column list */
  columnOrder: boolean;
  /**
   * Partial / filtered index: `CREATE INDEX … WHERE <predicate>`.
   * Indexes only the rows matching the predicate.
   */
  filter: boolean;
  hint: string;
};

const FULL: Omit<IndexFeatureSupport, 'hint'> = {
  create: true,
  drop: true,
  unique: true,
  acceptDuplicates: true,
  columnOrder: true,
  filter: true,
};

/** Traditional indexes without partial/filtered WHERE support. */
const FULL_NO_FILTER: Omit<IndexFeatureSupport, 'hint'> = {
  ...FULL,
  filter: false,
};

const MATRIX: Record<string, IndexFeatureSupport> = {
  clickhouse: {
    create: false,
    drop: false,
    unique: false,
    acceptDuplicates: false,
    columnOrder: false,
    filter: false,
    hint: 'ClickHouse has no traditional CREATE INDEX — use table engine / skipping indexes outside this blueprint.',
  },
  redshift: {
    create: false,
    drop: false,
    unique: false,
    acceptDuplicates: false,
    columnOrder: false,
    filter: false,
    hint: 'Redshift has no secondary indexes — use SORTKEY / DISTKEY instead.',
  },
  sqlite: {
    ...FULL,
    hint: 'SQLite: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC; partial WHERE filter.',
  },
  duckdb: {
    ...FULL_NO_FILTER,
    hint: 'DuckDB: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC. No partial WHERE filter.',
  },
  mysql: {
    ...FULL_NO_FILTER,
    hint: 'MySQL: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC. No partial WHERE filter.',
  },
  mariadb: {
    ...FULL_NO_FILTER,
    hint: 'MariaDB: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC. No partial WHERE filter.',
  },
  tidb: {
    ...FULL_NO_FILTER,
    hint: 'TiDB: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC. No partial WHERE filter.',
  },
  postgres: {
    ...FULL,
    hint: 'PostgreSQL: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC; partial WHERE filter.',
  },
  cockroachdb: {
    ...FULL,
    hint: 'CockroachDB: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC; partial WHERE filter.',
  },
  yugabytedb: {
    ...FULL,
    hint: 'YugabyteDB: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC; partial WHERE filter.',
  },
  sqlserver: {
    ...FULL,
    hint: 'SQL Server: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC; filtered WHERE. Unique constraints use ALTER TABLE.',
  },
  azuresql: {
    ...FULL,
    hint: 'Azure SQL: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC; filtered WHERE. Unique constraints use ALTER TABLE.',
  },
  oracle: {
    ...FULL_NO_FILTER,
    hint: 'Oracle: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC. No partial WHERE (use function-based indexes outside this form).',
  },
  db2: {
    ...FULL_NO_FILTER,
    hint: 'DB2: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC. No partial WHERE filter.',
  },
};

const DEFAULT_SUPPORT: IndexFeatureSupport = {
  ...FULL_NO_FILTER,
  hint: 'CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
};

/** Look up index feature flags for a dialect id. */
export function dialectSupportsIndex(dialectName: string): IndexFeatureSupport {
  return MATRIX[dialectName.toLowerCase()] ?? DEFAULT_SUPPORT;
}
