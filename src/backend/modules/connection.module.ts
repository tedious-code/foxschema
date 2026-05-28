import { Db2Provider } from '../providers/db2.provider';
import { PostgresProvider } from '../providers/postgres.provider';
import { MysqlProvider } from '../providers/mysql.provider';
import { ConnectionOptions, SchemaProvider } from '../interfaces/schema-provider.interface';

export class ConnectionModule {
  private providers: Record<string, SchemaProvider> = {
    db2: new Db2Provider(),
    postgres: new PostgresProvider(),
    mysql: new MysqlProvider(),
  };

  async testConnection(
    dialect: string,
    option: ConnectionOptions
  ): Promise<boolean> {

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
    const provider = this.providers[dialect.toLowerCase()];

    if (!provider) {
      throw new Error(`No provider registered for dialect: ${dialect}`);
    }

    return provider;
  }
}
