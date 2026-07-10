/**
 * Read per-dialect DB config from environment variables.
 *
 * Variable naming convention (uppercase dialect, SOURCE or TARGET side):
 *   E2E_<DIALECT>_SOURCE_HOST
 *   E2E_<DIALECT>_SOURCE_PORT
 *   E2E_<DIALECT>_SOURCE_DB
 *   E2E_<DIALECT>_SOURCE_USER
 *   E2E_<DIALECT>_SOURCE_PASS
 *   E2E_<DIALECT>_SOURCE_SCHEMA
 *
 * Example for Postgres:
 *   E2E_POSTGRES_SOURCE_HOST=localhost
 *   E2E_POSTGRES_SOURCE_PORT=5432
 *   E2E_POSTGRES_SOURCE_DB=mydb
 *   E2E_POSTGRES_SOURCE_USER=postgres
 *   E2E_POSTGRES_SOURCE_PASS=secret
 *   E2E_POSTGRES_SOURCE_SCHEMA=public
 */

export interface DbConfig {
  dialect: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema?: string;
}

function readConfig(envPrefix: string, dialect: string): DbConfig | null {
  const host = process.env[`${envPrefix}_HOST`];
  const db = process.env[`${envPrefix}_DB`];
  const user = process.env[`${envPrefix}_USER`];
  const pass = process.env[`${envPrefix}_PASS`];
  if (!host || !db || !user || !pass) return null;
  return {
    dialect,
    host,
    port: parseInt(process.env[`${envPrefix}_PORT`] ?? '0', 10) || defaultPort(dialect),
    database: db,
    username: user,
    password: pass,
    schema: process.env[`${envPrefix}_SCHEMA`],
  };
}

function defaultPort(dialect: string): number {
  const ports: Record<string, number> = {
    postgres: 5432, mysql: 3306, mariadb: 3306, sqlserver: 1433,
    oracle: 1521, db2: 50000, sqlite: 0, azuresql: 1433,
    clickhouse: 8123, redshift: 5439,
    cockroachdb: 26257, yugabytedb: 5433, tidb: 4000, duckdb: 0,
  };
  return ports[dialect] ?? 5432;
}

export function getSourceConfig(dialect: string): DbConfig | null {
  return readConfig(`E2E_${dialect.toUpperCase()}_SOURCE`, dialect);
}

export function getTargetConfig(dialect: string): DbConfig | null {
  return readConfig(`E2E_${dialect.toUpperCase()}_TARGET`, dialect);
}

export function hasConfig(dialect: string): boolean {
  return getSourceConfig(dialect) !== null && getTargetConfig(dialect) !== null;
}
