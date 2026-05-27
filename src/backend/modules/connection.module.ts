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

  let connected:boolean = false;
  
  switch(dialect) {
    case 'db2':
      connected = await provider.testConnection(option);
      break;
    case 'postgres':
      connected = await provider.testConnection(option);
      break;
    case 'mysql':
      connected = await provider.testConnection(option);
      break;
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }

  return connected;
}

getProvider(dialect: string): SchemaProvider {
  const provider = this.providers[dialect.toLowerCase()];

  if (!provider) {
    throw new Error(`No provider registered for dialect: ${dialect}`);
  }

  return provider;
}
}
