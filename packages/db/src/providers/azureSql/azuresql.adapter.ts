import { createRequire } from 'node:module';
import { type ConnectionOptions, type DriverAdapter } from '@foxschema/sql';
import { BoundedPoolCache, disposePoolEndOrClose } from '../../cores/pool-cache.js';
import { guardPoolErrors } from '../../cores/pool-error-guard.js';
import { buildMssqlPoolConfig } from '../sqlServer/sqlserver.config.js';

const nodeRequire = createRequire(import.meta.url);

type MssqlHandle =
  | { _type: 'pool'; pool: any }
  | { _type: 'tx'; pool: any; tx: any };

class AzureSqlAdapter implements DriverAdapter {
  readonly dialect = 'azuresql';
  readonly packageName = 'mssql';

  private pools = new BoundedPoolCache<any>(disposePoolEndOrClose);
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
    return buildMssqlPoolConfig(options, { encryptDefault: true });
  }

  async acquire(connectionString: string, options: ConnectionOptions, _pooled: boolean): Promise<MssqlHandle> {
    const mssql = this.load();
    const pool = await this.pools.getOrCreate(connectionString, async () => {
      const created = new mssql.ConnectionPool(this.buildConfig(options));
      guardPoolErrors(created, 'azuresql');
      await created.connect();
      return created;
    });
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

  /**
   * `arrayRowMode` makes mssql return arrays plus a column list, so a join
   * selecting `id` from two tables keeps both rather than collapsing them onto
   * one key of a row object.
   */
  async queryPositional(handle: MssqlHandle, sql: string, params: readonly unknown[]) {
    const mssql = this.load();
    const req = handle._type === 'tx'
      ? new mssql.Request(handle.tx)
      : new mssql.Request(handle.pool);
    req.arrayRowMode = true;
    params.forEach((value, i) => req.input(`p${i}`, value));

    const result = await req.query(sql);
    // `columns` is [[{name}, …]] — one entry per recordset.
    const meta = (result.columns?.[0] ?? []) as { name: string }[];
    return {
      columns: meta.map((c) => c.name),
      rows: (result.recordset ?? []) as unknown as unknown[][],
    };
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
    await this.pools.clear();
  }
}

export const azureSqlAdapter = new AzureSqlAdapter();
