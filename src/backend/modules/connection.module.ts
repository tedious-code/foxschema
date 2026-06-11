import { Db2Provider } from '../providers/db2/db2.provider';
import { PostgresProvider } from '../providers/postgres/postgres.provider';
import { MysqlProvider } from '../providers/mysql/mysql.provider';
import { DriverDetector } from '../cores/driver-detector';
import { ConnectionOptions, SchemaProvider } from '../interfaces/schema-provider.interface';

export class ConnectionModule {
  private providers: Record<string, SchemaProvider> = {
    db2: new Db2Provider(),
    postgres: new PostgresProvider(),
    mysql: new MysqlProvider(),
  };

  checkDriver(dialect: string) {
    return DriverDetector.checkDialect(dialect);
  }

  async testConnection(
    dialect: string,
    option: ConnectionOptions
  ): Promise<boolean> {
    DriverDetector.ensureDriver(dialect);

    const provider =
      this.providers[dialect.toLowerCase()];

    if (!provider) {
      throw new Error(
        `Unsupported dialect: ${dialect}`
      );
    }

    return provider.testConnection(option);
  }

  getProvider(dialect: string): SchemaProvider {
    DriverDetector.ensureDriver(dialect);

    const provider = this.providers[dialect.toLowerCase()];

    if (!provider) {
      throw new Error(`No provider registered for dialect: ${dialect}`);
    }

    return provider;
  }
}
