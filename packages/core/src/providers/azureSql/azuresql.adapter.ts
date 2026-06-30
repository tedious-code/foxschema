import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';

const nodeRequire = createRequire(import.meta.url);

type MssqlHandle =
  | { _type: 'pool'; pool: any }
  | { _type: 'tx'; pool: any; tx: any };

class AzureSqlAdapter implements DriverAdapter {
  readonly dialect = 'azuresql';
  readonly packageName = 'mssql';

  private pools = new Map<string, any>();
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    try {
      const mod = nodeRequire(this.packageName);
      this.driver = mod.default ?? mod;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for azuresql. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  private buildConfig(options: ConnectionOptions): Record<string, unknown> {
    return {
      server: options.host || '',
      port: options.port || 1433,
      database: options.database || '',
      user: options.username || '',
      password: options.password || '',
      options: {
        // Azure SQL always requires encryption
        encrypt: true,
        trustServerCertificate: options.ssl?.rejectUnauthorized === false,
        connectTimeout: options.timeout?.connectMs ?? 15000,
        requestTimeout: options.timeout?.queryMs ?? 30000,
      },
      pool: {
        max: options.pool?.max ?? 10,
        min: options.pool?.min ?? 1,
        idleTimeoutMillis: options.pool?.idleTimeoutMs ?? 30000,
      },
    };
  }

  async acquire(connectionString: string, options: ConnectionOptions, _pooled: boolean): Promise<MssqlHandle> {
    const mssql = this.load();
    let pool = this.pools.get(connectionString);
    if (!pool) {
      pool = new mssql.ConnectionPool(this.buildConfig(options));
      await pool.connect();
      this.pools.set(connectionString, pool);
    }
    return { _type: 'pool', pool };
  }

  async release(_handle: any): Promise<void> {}

  async query<T = Record<string, unknown>>(handle: MssqlHandle, sql: string, params: readonly unknown[]): Promise<T[]> {
    const mssql = this.load();
    const req = handle._type === 'tx'
      ? new mssql.Request(handle.tx)
      : new mssql.Request(handle.pool);
    params.forEach((value, i) => req.input(`p${i}`, value));
    const result = await req.query(sql);
    return result.recordset as T[];
  }

  async beginTransaction(handle: MssqlHandle): Promise<void> {
    const mssql = this.load();
    const tx = new mssql.Transaction((handle as any).pool);
    await tx.begin();
    (handle as any)._type = 'tx';
    (handle as any).tx = tx;
  }

  async commitTransaction(handle: MssqlHandle): Promise<void> {
    if (handle._type === 'tx') await handle.tx.commit();
    (handle as any)._type = 'pool';
    (handle as any).tx = undefined;
  }

  async rollbackTransaction(handle: MssqlHandle): Promise<void> {
    if (handle._type === 'tx') {
      try { await handle.tx.rollback(); } catch { /* ignore */ }
    }
    (handle as any)._type = 'pool';
    (handle as any).tx = undefined;
  }

  async setCurrentSchema(_handle: MssqlHandle, _schema: string): Promise<void> {
    // Azure SQL schemas are part of the object qualifier — not a session variable.
  }

  async closeAll(): Promise<void> {
    const pools = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.all(pools.map((p) => (typeof p.close === 'function' ? p.close() : Promise.resolve())));
  }
}

export const azureSqlAdapter = new AzureSqlAdapter();
