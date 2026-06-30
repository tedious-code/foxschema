import type { SqlDialect } from './sql-dialect.interface';
import { db2SqlDialect } from '../providers/db2/db2.sql-dialect';
import { postgresSqlDialect } from '../providers/postgres/postgres.sql-dialect';
import { mysqlSqlDialect, mariadbSqlDialect } from '../providers/mysql/mysql.sql-dialect';
import { sqlServerSqlDialect } from '../providers/sqlServer/sqlserver.sql-dialect';
import { oracleSqlDialect } from '../providers/oracle/oracle.sql-dialect';
import { sqliteSqlDialect } from '../providers/sqlLite/sqlite.sql-dialect';
import { redshiftSqlDialect } from '../providers/redshift/redshift.sql-dialect';
import { clickHouseSqlDialect } from '../providers/clickHouse/clickhouse.sql-dialect';
import { azureSqlDialect } from '../providers/azureSql/azuresql.sql-dialect';

/** Maps a dialect name (case-insensitive) to its SQL generation strategy. */
export const DIALECT_MAP: Record<string, SqlDialect> = {
  DB2: db2SqlDialect,
  POSTGRES: postgresSqlDialect,
  MYSQL: mysqlSqlDialect,
  MARIADB: mariadbSqlDialect,
  SQLSERVER: sqlServerSqlDialect,
  ORACLE: oracleSqlDialect,
  SQLITE: sqliteSqlDialect,
  REDSHIFT: redshiftSqlDialect,
  CLICKHOUSE: clickHouseSqlDialect,
  AZURESQL: azureSqlDialect,
};

/** Resolve a dialect name to its strategy, defaulting to Db2 for unknown names. */
export function resolveDialect(dialect: string): SqlDialect {
  return DIALECT_MAP[dialect.toUpperCase()] ?? db2SqlDialect;
}
