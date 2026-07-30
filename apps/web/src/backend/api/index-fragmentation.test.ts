import { describe, expect, it } from 'vitest';
import { mapPool } from './index-fragmentation';

describe('mapPool', () => {
  it('preserves order with bounded concurrency', async () => {
    const started: number[] = [];
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 5));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(started).toHaveLength(5);
  });
});
