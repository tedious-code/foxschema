import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';

const nodeRequire = createRequire(import.meta.url);

// ClickHouse uses HTTP — the "connection" is a stateless client instance.
// Transactions are experimental in ClickHouse; begin/commit/rollback are no-ops here.
class ClickHouseAdapter implements DriverAdapter {
  readonly dialect = 'clickhouse';
  readonly packageName = '@clickhouse/client';

  private clients = new Map<string, any>();
  private mod: any;

  private load(): any {
    if (this.mod) return this.mod;
    try {
      const m = nodeRequire(this.packageName);
      this.mod = m.default ?? m;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for clickhouse. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.mod;
  }

  async acquire(connectionString: string, options: ConnectionOptions, _pooled: boolean): Promise<any> {
    if (this.clients.has(connectionString)) return this.clients.get(connectionString)!;
    const { createClient } = this.load();
    const client = createClient({
      url: connectionString,
      username: options.username || 'default',
      password: options.password || '',
      database: options.database || options.schema || 'default',
      request_timeout: options.timeout?.queryMs ?? 30000,
      compression: { response: true, request: false },
    });
    this.clients.set(connectionString, client);
    return client;
  }

  async release(_client: any): Promise<void> {
    // HTTP is stateless — nothing to release.
  }

  async query<T = Record<string, unknown>>(client: any, sql: string, params: readonly unknown[]): Promise<T[]> {
    // Replace $N positional placeholders with quoted values (catalog queries only; no user data).
    let finalSql = sql;
    if (params.length > 0) {
      finalSql = sql.replace(/\$(\d+)/g, (_, idx) => {
        const val = params[Number(idx) - 1];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return String(val);
        return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
      });
    }
    const result = await client.query({ query: finalSql, format: 'JSONEachRow' });
    return result.json() as Promise<T[]>;
  }

  async beginTransaction(_client: any): Promise<void> {
    // ClickHouse transactions are experimental — migrations run as individual DDL statements.
  }

  async commitTransaction(_client: any): Promise<void> {}

  async rollbackTransaction(_client: any): Promise<void> {}

  async setCurrentSchema(_client: any, _schema: string): Promise<void> {
    // ClickHouse database is set at client-creation time; DDL must be schema-qualified.
  }

  async closeAll(): Promise<void> {
    const clients = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(clients.map((c) => (typeof c.close === 'function' ? c.close() : Promise.resolve())));
  }
}

export const clickHouseAdapter = new ClickHouseAdapter();
