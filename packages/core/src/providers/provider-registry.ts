import { SchemaProvider } from '../interfaces';
import { Db2Provider } from './db2/db2.provider';
import { PostgresProvider } from './postgres/postgres.provider';
import { MysqlProvider } from './mysql/mysql.provider';
import { MariadbProvider } from './mysql/mariadb.provider';
import { SqlServerProvider } from './sqlServer/sqlserver.provider';
import { OracleProvider } from './oracle/oracle.provider';
import { SqliteProvider } from './sqlLite/sqlLite.provider';
import { RedshiftProvider } from './redshift/redshift.provider';
import { ClickHouseProvider } from './clickHouse/clickhouse.provider';
import { AzureSqlProvider } from './azureSql/azuresql.provider';
import { CockroachDbProvider } from './cockroachDb/cockroachdb.provider';
import { YugabyteDbProvider } from './yugabyteDb/yugabytedb.provider';
import { TiDbProvider } from './tiDb/tidb.provider';

// Register a dialect's schema provider (queries) here — one line per platform.
export const PROVIDERS: Record<string, SchemaProvider> = {
  db2: new Db2Provider(),
  postgres: new PostgresProvider(),
  mysql: new MysqlProvider(),
  mariadb: new MariadbProvider(),
  sqlserver: new SqlServerProvider(),
  oracle: new OracleProvider(),
  sqlite: new SqliteProvider(),
  redshift: new RedshiftProvider(),
  clickhouse: new ClickHouseProvider(),
  azuresql: new AzureSqlProvider(),
  cockroachdb: new CockroachDbProvider(),
  yugabytedb: new YugabyteDbProvider(),
  tidb: new TiDbProvider(),
};

export function getRegisteredProvider(dialect: string): SchemaProvider {
  const provider = PROVIDERS[dialect.toLowerCase()];
  if (!provider) {
    throw new Error(`No provider registered for dialect: ${dialect}`);
  }
  return provider;
}
