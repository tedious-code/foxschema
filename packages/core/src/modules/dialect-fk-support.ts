/**
 * Central dialect × FK-feature bitmatrix used by generators and (mirrored)
 * by the table blueprint UI.
 */

export type FkFeatureSupport = {
  alterAdd: boolean;
  createInline: boolean;
  composite: boolean;
  hint: string;
};

const FULL: Omit<FkFeatureSupport, 'hint'> = {
  alterAdd: true,
  createInline: true,
  composite: true,
};

const MATRIX: Record<string, FkFeatureSupport> = {
  clickhouse: {
    alterAdd: false,
    createInline: false,
    composite: false,
    hint: 'ClickHouse has no foreign-key constraints.',
  },
  sqlite: {
    alterAdd: false,
    createInline: true,
    composite: true,
    hint: 'SQLite: declare FOREIGN KEY in CREATE TABLE only (no ALTER ADD). One or more columns OK.',
  },
  redshift: {
    ...FULL,
    hint: 'Redshift accepts FK syntax (informational). Single or composite columns OK.',
  },
  duckdb: {
    ...FULL,
    hint: 'DuckDB: FOREIGN KEY on one or more columns via CREATE or ALTER.',
  },
  mysql: {
    ...FULL,
    hint: 'MySQL/MariaDB/TiDB: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  mariadb: {
    ...FULL,
    hint: 'MySQL/MariaDB/TiDB: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  tidb: {
    ...FULL,
    hint: 'MySQL/MariaDB/TiDB: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  postgres: {
    ...FULL,
    hint: 'PostgreSQL-compatible: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  cockroachdb: {
    ...FULL,
    hint: 'PostgreSQL-compatible: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  yugabytedb: {
    ...FULL,
    hint: 'PostgreSQL-compatible: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  sqlserver: {
    ...FULL,
    hint: 'SQL Server / Azure SQL: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  azuresql: {
    ...FULL,
    hint: 'SQL Server / Azure SQL: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  oracle: {
    ...FULL,
    hint: 'Oracle: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
  db2: {
    ...FULL,
    hint: 'DB2: ADD CONSTRAINT FOREIGN KEY; composite supported.',
  },
};

const DEFAULT_SUPPORT: FkFeatureSupport = {
  ...FULL,
  hint: 'FOREIGN KEY on one or more columns via CREATE or ALTER.',
};

/** Look up FK feature flags for a dialect id. */
export function dialectSupportsFk(dialectName: string): FkFeatureSupport {
  return MATRIX[dialectName.toLowerCase()] ?? DEFAULT_SUPPORT;
}
