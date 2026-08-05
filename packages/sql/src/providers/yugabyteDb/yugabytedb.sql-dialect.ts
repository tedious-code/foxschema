// YugabyteDB's YSQL reuses the PostgreSQL query layer, so its DDL is
// Postgres-compatible — reuse the Postgres strategy.
export { postgresSqlDialect as yugabyteDbSqlDialect } from '../postgres/postgres.sql-dialect';
