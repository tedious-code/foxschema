import { createRequire } from 'node:module';
import { ConnectionOptions, DriverAdapter, parseSqlSubset, subsetValue } from '@foxschema/sql';
import { credentialedCacheKey } from '../../cores/pool-cache';

const nodeRequire = createRequire(import.meta.url);

/**
 * Redis behind the SQL editor, for the cache-maintenance case.
 *
 * Redis has no SQL and no tables. The mapping that makes it addressable is:
 *
 *   "table"  → a key prefix, so `users` covers `users:*`
 *   "row"    → one hash at `users:<id>`
 *   "column" → a field of that hash, plus the synthetic `id`
 *
 * Hashes rather than plain strings because a row has named fields, and HSET /
 * HGETALL map onto them exactly. A key holding a plain string is reported as a
 * single `value` field so browsing still works, but it cannot be updated
 * field-wise — that is stated, not silently approximated.
 *
 * Every statement goes through `parseSqlSubset`; anything outside it is
 * refused. That matters more here than anywhere else, because there is no
 * server-side query engine to catch a mistranslation — a wrong pattern in a
 * DELETE would simply remove different keys.
 *
 * SCAN, never KEYS: KEYS blocks the server for the length of the keyspace, and
 * a cache is exactly where that hurts.
 */
class RedisAdapter implements DriverAdapter {
  readonly dialect = 'redis';
  readonly packageName = 'redis';

  private clients = new Map<string, any>();
  private mod: any;

  private load(): any {
    if (this.mod) return this.mod;
    try {
      const m = nodeRequire(this.packageName);
      this.mod = m.default ?? m;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Database driver "${this.packageName}" is not installed for redis. Install it with: npm install ${this.packageName} — ${message}`
      );
    }
    return this.mod;
  }

  async acquire(connectionString: string, options: ConnectionOptions, _pooled: boolean): Promise<any> {
    const { createClient } = this.load();
    const key = credentialedCacheKey({
      connectionString,
      username: options.username || '',
      password: options.password || '',
      database: options.database || '0',
    });
    let client = this.clients.get(key);
    if (!client) {
      client = createClient({
        url: connectionString,
        ...(options.username ? { username: options.username } : {}),
        ...(options.password ? { password: options.password } : {}),
      });
      client.on('error', () => {
        // The driver emits on transient drops; throwing here would take the
        // process down. Failures surface on the command itself instead.
      });
      await client.connect();
      this.clients.set(key, client);
    }
    return client;
  }

  async release(_connection: any): Promise<void> {
    // Connections are reused; closeAll disconnects them.
  }

  /** `users` + id `7` → `users:7`. */
  private keyFor(table: string, id: unknown): string {
    return `${table}:${String(id)}`;
  }

  /** Read one key as a row, whatever type it holds. */
  private async readRow(
    client: any,
    table: string,
    key: string
  ): Promise<Record<string, unknown> | null> {
    const type = await client.type(key);
    const id = key.startsWith(`${table}:`) ? key.slice(table.length + 1) : key;
    if (type === 'hash') {
      const hash = await client.hGetAll(key);
      if (!hash || Object.keys(hash).length === 0) return null;
      return { id, ...hash };
    }
    if (type === 'string') {
      const value = await client.get(key);
      return value === null ? null : { id, value };
    }
    // list/set/zset/stream have no row shape; report the type rather than
    // inventing columns for them.
    return type === 'none' ? null : { id, type };
  }

  async query<T = Record<string, unknown>>(
    connection: any,
    sql: string,
    params: readonly unknown[]
  ): Promise<T[]> {
    const parsed = parseSqlSubset(sql);
    if (!parsed.ok) throw new Error(`Redis: ${parsed.error}`);
    const intent = parsed.intent;
    const client = connection;

    const idFrom = (
      pairs: ReadonlyArray<{ column: string; value: any }>
    ): unknown | undefined => {
      const hit = pairs.find((p) => p.column === 'id');
      return hit ? subsetValue(hit.value, params) : undefined;
    };

    switch (intent.kind) {
      case 'select': {
        const id = idFrom(intent.where);
        if (id !== undefined) {
          const row = await this.readRow(client, intent.table, this.keyFor(intent.table, id));
          return (row ? [row] : []) as T[];
        }
        // No id: scan the prefix. Bounded by LIMIT so browsing a large cache
        // cannot walk the whole keyspace.
        const limit = intent.limit ?? 100;
        const rows: Record<string, unknown>[] = [];
        // node-redis v6 yields a *batch* of keys per iteration; older clients
        // yielded one key. Normalising both is not defensive noise — assuming
        // the single-key shape made String(['a','b']) the key, so every scan
        // silently returned nothing.
        outer: for await (const batch of client.scanIterator({
          MATCH: `${intent.table}:*`,
          COUNT: 200,
        })) {
          const keys: string[] = Array.isArray(batch)
            ? batch.map((k) => String(k))
            : [String(batch)];
          for (const k of keys) {
            const row = await this.readRow(client, intent.table, k);
            if (row) rows.push(row);
            if (rows.length >= limit) break outer;
          }
        }
        // Non-id equality predicates filter after the read — Redis has no
        // secondary index to push them down to.
        const extra = intent.where.filter((w) => w.column !== 'id');
        const filtered = extra.length
          ? rows.filter((r) =>
              extra.every((w) => String(r[w.column] ?? '') === String(subsetValue(w.value, params) ?? ''))
            )
          : rows;
        return filtered as T[];
      }
      case 'insert': {
        const doc: Record<string, string> = {};
        let id: unknown;
        for (const a of intent.assignments) {
          const value = subsetValue(a.value, params);
          if (a.column === 'id') id = value;
          else doc[a.column] = value === null || value === undefined ? '' : String(value);
        }
        if (id === undefined) throw new Error('Redis: INSERT needs an `id` column to form the key.');
        const key = this.keyFor(intent.table, id);
        if (Object.keys(doc).length > 0) await client.hSet(key, doc);
        else await client.hSet(key, { id: String(id) });
        return [{ rowCount: 1, key }] as T[];
      }
      case 'update': {
        const id = idFrom(intent.where);
        if (id === undefined) {
          throw new Error('Redis: UPDATE needs `id` in the WHERE clause to address a key.');
        }
        const key = this.keyFor(intent.table, id);
        if ((await client.exists(key)) === 0) return [{ rowCount: 0 }] as T[];
        const set: Record<string, string> = {};
        for (const s of intent.set) {
          if (s.column === 'id') continue; // renaming the key is not an update
          const value = subsetValue(s.value, params);
          set[s.column] = value === null || value === undefined ? '' : String(value);
        }
        if (Object.keys(set).length > 0) await client.hSet(key, set);
        return [{ rowCount: 1, key }] as T[];
      }
      case 'delete': {
        const id = idFrom(intent.where);
        if (id === undefined) {
          throw new Error('Redis: DELETE needs `id` in the WHERE clause to address a key.');
        }
        const removed = await client.del(this.keyFor(intent.table, id));
        return [{ rowCount: removed }] as T[];
      }
    }
  }

  // Redis MULTI is not a rollback-capable transaction: queued commands cannot
  // be undone once EXEC runs. Pretending otherwise would make a failed migrate
  // claim it rolled back when it did not.
  async beginTransaction(_connection: any): Promise<void> {}
  async commitTransaction(_connection: any): Promise<void> {}
  async rollbackTransaction(_connection: any): Promise<void> {}

  async setCurrentSchema(connection: any, schema: string): Promise<void> {
    const n = Number(schema);
    if (Number.isInteger(n) && n >= 0) await connection.select(n);
  }

  async closeAll(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
  }
}

export const redisAdapter = new RedisAdapter();
