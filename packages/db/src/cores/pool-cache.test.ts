import { describe, expect, it, vi } from 'vitest';
import {
  BoundedPoolCache,
  credentialedCacheKey,
  nonSecretFingerprint,
} from './pool-cache.js';

describe('nonSecretFingerprint / credentialedCacheKey', () => {
  it('fingerprints stably without echoing the secret', () => {
    const a = nonSecretFingerprint('secret-a');
    const b = nonSecretFingerprint('secret-b');
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
    expect(nonSecretFingerprint('secret-a')).toBe(a);
  });

  it('partitions Oracle-style keys by username and password', () => {
    const base = {
      connectionString: 'db.example:1521/ORCL',
      username: 'demo_a',
    };
    const correct = credentialedCacheKey({ ...base, password: 'right' });
    const wrongPw = credentialedCacheKey({ ...base, password: 'wrong' });
    const otherUser = credentialedCacheKey({
      ...base,
      username: 'demo_b',
      password: 'right',
    });
    expect(correct).not.toBe(wrongPw);
    expect(correct).not.toBe(otherUser);
    expect(correct).toContain('db.example:1521/ORCL');
    expect(correct).not.toContain('right');
  });

  it('partitions ClickHouse-style keys by database and credentials', () => {
    const url = 'http://ch:8123';
    const dbA = credentialedCacheKey({
      connectionString: url,
      username: 'default',
      password: 'p',
      database: 'analytics',
    });
    const dbB = credentialedCacheKey({
      connectionString: url,
      username: 'default',
      password: 'p',
      database: 'staging',
    });
    const otherUser = credentialedCacheKey({
      connectionString: url,
      username: 'reader',
      password: 'p',
      database: 'analytics',
    });
    expect(dbA).not.toBe(dbB);
    expect(dbA).not.toBe(otherUser);
  });
});

describe('BoundedPoolCache', () => {
  it('reuses existing pools and refreshes LRU order', async () => {
    const dispose = vi.fn(async () => {});
    const cache = new BoundedPoolCache<{ id: number }>(dispose, { maxPools: 2, idleTtlMs: 60_000 });
    const a = await cache.getOrCreate('a', () => ({ id: 1 }));
    const a2 = await cache.getOrCreate('a', () => ({ id: 99 }));
    expect(a2).toBe(a);
    expect(cache.size()).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('evicts oldest when over maxPools', async () => {
    const disposed: string[] = [];
    const cache = new BoundedPoolCache<{ key: string }>(
      async (p) => {
        disposed.push(p.key);
      },
      { maxPools: 2, idleTtlMs: 60_000 }
    );
    await cache.getOrCreate('a', () => ({ key: 'a' }));
    await cache.getOrCreate('b', () => ({ key: 'b' }));
    await cache.getOrCreate('c', () => ({ key: 'c' }));
    expect(cache.size()).toBe(2);
    expect(disposed).toContain('a');
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.peek('b')).toBeDefined();
    expect(cache.peek('c')).toBeDefined();
  });

  it('clear disposes all pools', async () => {
    const dispose = vi.fn(async () => {});
    const cache = new BoundedPoolCache<object>(dispose, { maxPools: 8, idleTtlMs: 60_000 });
    await cache.getOrCreate('a', () => ({}));
    await cache.getOrCreate('b', () => ({}));
    await cache.clear();
    expect(cache.size()).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent getOrCreate for the same key', async () => {
    const dispose = vi.fn(async () => {});
    const cache = new BoundedPoolCache<{ id: number }>(dispose, { maxPools: 4, idleTtlMs: 60_000 });
    let creates = 0;
    const create = () =>
      new Promise<{ id: number }>((resolve) => {
        creates += 1;
        setTimeout(() => resolve({ id: creates }), 20);
      });

    const [a, b, c] = await Promise.all([
      cache.getOrCreate('x', create),
      cache.getOrCreate('x', create),
      cache.getOrCreate('x', create),
    ]);
    expect(creates).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(cache.size()).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
  });
});
