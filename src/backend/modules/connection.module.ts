import { Db2Provider } from '../providers/db2.provider';
import { PostgresProvider } from '../providers/postgres.provider';
import { MysqlProvider } from '../providers/mysql.provider';
import { SchemaProvider } from '../interfaces/schema-provider.interface';

export class ConnectionModule {
  private providers: Record<string, SchemaProvider> = {
    db2: new Db2Provider(),
    postgres: new PostgresProvider(),
    mysql: new MysqlProvider(),
  };

  async testConnection(dialect: string, connectionString: string): Promise<boolean> {
    if (!this.providers[dialect.toLowerCase()]) {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }
    // Simulate latency
    await new Promise((resolve) => setTimeout(resolve, 800));
    return connectionString.length > 5;
  }

  getProvider(dialect: string): SchemaProvider {
    const provider = this.providers[dialect.toLowerCase()];
    if (!provider) {
      throw new Error(`No provider registered for dialect: ${dialect}`);
    }
    return provider;
  }
}
