// CockroachDB uses PostgreSQL-compatible DDL (GENERATED ALWAYS AS IDENTITY,
// ALTER COLUMN, function overloading, etc.), so it reuses the Postgres strategy.
export { postgresSqlDialect as cockroachDbSqlDialect } from '../postgres/postgres.sql-dialect';
