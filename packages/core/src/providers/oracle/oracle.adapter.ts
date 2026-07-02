import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter } from '../../interfaces/schema-provider.interface';

const nodeRequire = createRequire(import.meta.url);

type OracleHandle =
  | { _type: 'pool'; pool: any; conn: any }
  | { _type: 'tx'; conn: any };

/**
 * Oracle adapter via oracledb. Requires Oracle Instant Client to be installed
 * and ORACLE_HOME / LD_LIBRARY_PATH set (or thick mode initialized).
 * Bind variables use positional :1, :2, … syntax as written by the provider.
 */
class OracleAdapter implements DriverAdapter {
  readonly dialect = 'oracle';
  readonly packageName = 'oracledb';

  private pools = new Map<string, any>();
  private driver: any;

  private load(): any {
    if (this.driver) return this.driver;
    try {
      const mod = nodeRequire(this.packageName);
      this.driver = mod.default ?? mod;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Database driver "${this.packageName}" is not installed for oracle. Install it with: npm install ${this.packageName} — ${message}`);
    }
    return this.driver;
  }

  async acquire(connectionString: string, options: ConnectionOptions, pooled: boolean): Promise<OracleHandle> {
    const oracledb = this.load();
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    // Return CLOBs as plain strings, not Lob stream objects. DBMS_METADATA.GET_DDL
    // (used for view definitions) returns a CLOB; without this it stringifies to
    // "[object Object]" and the view body is lost.
    oracledb.fetchAsString = [oracledb.CLOB];

    if (!pooled) {
      const conn = await oracledb.getConnection({
        user: options.username || '',
        password: options.password || '',
        connectString: connectionString,
      });
      return { _type: 'tx', conn };
    }

    // Key pools by user AND connect string. Oracle's connect string
    // (host:port/service) carries no username — it's passed separately — and
    // source/target routinely connect to the SAME service as DIFFERENT users
    // (schema-per-user model, e.g. demo_a vs demo_b). Keying by connect string
    // alone made the second user silently reuse the first user's pool, so its
    // catalog queries ran under the wrong account and returned zero objects —
    // the compare then reported every target object as ADDED.
    const poolKey = `${options.username ?? ''}@${connectionString}`;
    let pool = this.pools.get(poolKey);
    if (!pool) {
      pool = await oracledb.createPool({
        user: options.username || '',
        password: options.password || '',
        connectString: connectionString,
        poolMax: options.pool?.max ?? 10,
        poolMin: options.pool?.min ?? 1,
        poolTimeout: Math.ceil((options.pool?.idleTimeoutMs ?? 60000) / 1000),
        connectTimeout: Math.ceil((options.timeout?.connectMs ?? 15000) / 1000),
      });
      this.pools.set(poolKey, pool);
    }
    const conn = await pool.getConnection();
    return { _type: 'pool', pool, conn };
  }

  async release(handle: OracleHandle): Promise<void> {
    if (!handle) return;
    try {
      if (handle._type === 'pool') {
        await handle.conn.close();
      } else {
        await handle.conn.close();
      }
    } catch { /* ignore */ }
  }

  async query<T = Record<string, unknown>>(handle: OracleHandle, sql: string, params: readonly unknown[]): Promise<T[]> {
    const conn: any = handle._type === 'pool' ? handle.conn : handle.conn;
    const result = await conn.execute(sql, params as any[], { outFormat: this.load().OUT_FORMAT_OBJECT });
    return (result.rows ?? []) as T[];
  }

  async beginTransaction(_handle: OracleHandle): Promise<void> {
    // Oracle auto-begins a transaction on DML; no explicit BEGIN needed.
  }

  async commitTransaction(handle: OracleHandle): Promise<void> {
    await handle.conn.commit();
  }

  async rollbackTransaction(handle: OracleHandle): Promise<void> {
    try { await handle.conn.rollback(); } catch { /* ignore */ }
  }

  async setCurrentSchema(handle: OracleHandle, schema: string): Promise<void> {
    await this.query(handle, `ALTER SESSION SET CURRENT_SCHEMA = "${schema.toUpperCase()}"`, []);
  }

  async closeAll(): Promise<void> {
    const pools = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.all(pools.map((p) => (typeof p.close === 'function' ? p.close() : Promise.resolve())));
  }
}

export const oracleAdapter = new OracleAdapter();
