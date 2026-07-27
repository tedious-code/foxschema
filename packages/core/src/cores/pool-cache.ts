/**
 * Bounded connection-pool registry for driver adapters.
 *
 * Keys may embed credentials (connection strings) — they live only in
 * server/process memory and must never be logged. Eviction calls `dispose`
 * so idle pools do not grow without bound across many credentials.
 */

export type PoolDispose<T> = (pool: T) => void | Promise<void>;

const DEFAULT_MAX_POOLS = 16;
const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;

export class BoundedPoolCache<T> {
  private readonly entries = new Map<string, { pool: T; lastUsed: number }>();
  private readonly maxPools: number;
  private readonly idleTtlMs: number;
  private readonly dispose: PoolDispose<T>;

  constructor(
    dispose: PoolDispose<T>,
    opts?: { maxPools?: number; idleTtlMs?: number }
  ) {
    this.dispose = dispose;
    this.maxPools = opts?.maxPools ?? DEFAULT_MAX_POOLS;
    this.idleTtlMs = opts?.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
  }

  size(): number {
    return this.entries.size;
  }

  /** Touch + return an existing pool, or undefined. */
  peek(key: string): T | undefined {
    void this.evictExpiredSync();
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    hit.lastUsed = Date.now();
    // Refresh insertion order for LRU.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.pool;
  }

  /** Get existing pool or create one, enforcing max size + idle TTL. */
  async getOrCreate(key: string, create: () => T | Promise<T>): Promise<T> {
    await this.evictExpired();
    const existing = this.peek(key);
    if (existing !== undefined) return existing;

    while (this.entries.size >= this.maxPools) {
      await this.evictOldest();
    }

    const pool = await create();
    this.entries.set(key, { pool, lastUsed: Date.now() });
    return pool;
  }

  async clear(): Promise<void> {
    const pools = [...this.entries.values()].map((e) => e.pool);
    this.entries.clear();
    await Promise.all(pools.map((p) => Promise.resolve(this.dispose(p))));
  }

  private evictExpiredSync(): string[] {
    const now = Date.now();
    const stale: string[] = [];
    for (const [key, e] of this.entries) {
      if (now - e.lastUsed >= this.idleTtlMs) stale.push(key);
    }
    return stale;
  }

  private async evictExpired(): Promise<void> {
    for (const key of this.evictExpiredSync()) {
      await this.evictKey(key);
    }
  }

  private async evictOldest(): Promise<void> {
    const oldest = this.entries.keys().next().value;
    if (oldest === undefined) return;
    await this.evictKey(oldest);
  }

  private async evictKey(key: string): Promise<void> {
    const hit = this.entries.get(key);
    if (!hit) return;
    this.entries.delete(key);
    await Promise.resolve(this.dispose(hit.pool));
  }
}

/** Dispose helper used by most Node pool drivers (`end` or `close`). */
export async function disposePoolEndOrClose(pool: {
  end?: () => unknown;
  close?: ((cb?: () => void) => unknown) | (() => unknown);
}): Promise<void> {
  if (typeof pool.end === 'function') {
    await pool.end();
    return;
  }
  if (typeof pool.close === 'function') {
    const close = pool.close.bind(pool);
    await new Promise<void>((resolve) => {
      try {
        const ret = close(() => resolve());
        if (ret && typeof (ret as Promise<void>).then === 'function') {
          void (ret as Promise<void>).then(() => resolve()).catch(() => resolve());
        } else if (close.length === 0) {
          resolve();
        }
      } catch {
        resolve();
      }
    });
  }
}
