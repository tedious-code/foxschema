import { describe, expect, it, vi } from 'vitest';
import { BoundedPoolCache } from './pool-cache';

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
});
