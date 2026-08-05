// TiDB is MySQL-compatible at the DDL level, so it reuses the MySQL strategy.
export { mysqlSqlDialect as tiDbSqlDialect } from '../mysql/mysql.sql-dialect';
