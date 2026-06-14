import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';

/**
 * MySQL adapter — placeholder. The MySQL provider's queries aren't implemented
 * yet, so connection handling throws clearly rather than half-working.
 * Implement against `mysql2` (pool + promise API) when MySQL support lands.
 */
class MysqlAdapter implements DriverAdapter {
  readonly dialect = 'mysql';
  readonly packageName = 'mysql2';

  private notImplemented(): never {
    throw new Error('MySQL driver adapter is not implemented yet.');
  }

  async acquire(_connectionString: string, _options: ConnectionOptions, _pooled: boolean): Promise<any> {
    this.notImplemented();
  }
  async release(): Promise<void> {}
  async query<T = Record<string, unknown>>(): Promise<T[]> {
    this.notImplemented();
  }
  async beginTransaction(): Promise<void> {
    this.notImplemented();
  }
  async commitTransaction(): Promise<void> {
    this.notImplemented();
  }
  async rollbackTransaction(): Promise<void> {
    this.notImplemented();
  }
  async setCurrentSchema(): Promise<void> {
    this.notImplemented();
  }
  async closeAll(): Promise<void> {}
}

export const mysqlAdapter = new MysqlAdapter();
