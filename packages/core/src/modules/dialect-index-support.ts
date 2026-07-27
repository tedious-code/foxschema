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
  hint: string;
};

const FULL: Omit<IndexFeatureSupport, 'hint'> = {
  create: true,
  drop: true,
  unique: true,
  acceptDuplicates: true,
  columnOrder: true,
};

const MATRIX: Record<string, IndexFeatureSupport> = {
  clickhouse: {
    create: false,
    drop: false,
    unique: false,
    acceptDuplicates: false,
    columnOrder: false,
    hint: 'ClickHouse has no traditional CREATE INDEX — use table engine / skipping indexes outside this blueprint.',
  },
  redshift: {
    create: false,
    drop: false,
    unique: false,
    acceptDuplicates: false,
    columnOrder: false,
    hint: 'Redshift has no secondary indexes — use SORTKEY / DISTKEY instead.',
  },
  sqlite: {
    ...FULL,
    hint: 'SQLite: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
  },
  duckdb: {
    ...FULL,
    hint: 'DuckDB: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
  },
  mysql: {
    ...FULL,
    hint: 'MySQL: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC (honored on 8+ InnoDB).',
  },
  mariadb: {
    ...FULL,
    hint: 'MariaDB: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC per column.',
  },
  tidb: {
    ...FULL,
    hint: 'TiDB: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC per column.',
  },
  postgres: {
    ...FULL,
    hint: 'PostgreSQL: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
  },
  cockroachdb: {
    ...FULL,
    hint: 'CockroachDB: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
  },
  yugabytedb: {
    ...FULL,
    hint: 'YugabyteDB: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
  },
  sqlserver: {
    ...FULL,
    hint: 'SQL Server: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC. Unique constraints use ALTER TABLE.',
  },
  azuresql: {
    ...FULL,
    hint: 'Azure SQL: CREATE/DROP INDEX … ON table; UNIQUE or non-unique; ASC/DESC. Unique constraints use ALTER TABLE.',
  },
  oracle: {
    ...FULL,
    hint: 'Oracle: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
  },
  db2: {
    ...FULL,
    hint: 'DB2: CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
  },
};

const DEFAULT_SUPPORT: IndexFeatureSupport = {
  ...FULL,
  hint: 'CREATE/DROP INDEX; UNIQUE or non-unique; ASC/DESC per column.',
};

/** Look up index feature flags for a dialect id. */
export function dialectSupportsIndex(dialectName: string): IndexFeatureSupport {
  return MATRIX[dialectName.toLowerCase()] ?? DEFAULT_SUPPORT;
}
