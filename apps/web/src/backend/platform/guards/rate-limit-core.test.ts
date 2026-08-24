import { describe, it, expect } from 'vitest';
import { RateLimitCore } from './rate-limit-core';

describe('memory safety under a distinct-key flood', () => {
  /**
   * The periodic sweep bounds keys over time, not between sweeps: a flood from
   * rotating source addresses can add one key per request for a full 30s.
   * That is the exhaustion this limiter exists to prevent, so it must not be
   * the way to cause it.
   */
  it('stops growing once the ceiling is reached', () => {
    const core = new RateLimitCore({ windowMs: 60_000, max: 5 });
    const now = 1_000_000;
    for (let i = 0; i < 25_000; i++) core.consume(`ip-${i}`, now);
    // 20k cap; the exact figure matters less than it being bounded.
    expect(core.size).toBeLessThanOrEqual(20_000);
  });

  it('refuses new keys rather than evicting established ones', () => {
    // Recency-based eviction would be backwards: under a flood the attacker's
    // buckets are the freshest, so evicting by recency discards the legitimate
    // users and hands the attacker a clean allowance.
    const core = new RateLimitCore({ windowMs: 60_000, max: 5 });
    const now = 1_000_000;
    core.consume('legit', now);
    for (let i = 0; i < 25_000; i++) core.consume(`flood-${i}`, now);
    // The established key is still tracked and still has its allowance.
    const d = core.consume('legit', now);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBeLessThan(5);
  });

  it('lets keys through again once the window drains', () => {
    const core = new RateLimitCore({ windowMs: 1_000, max: 5 });
    const now = 1_000_000;
    for (let i = 0; i < 25_000; i++) core.consume(`ip-${i}`, now);
    // Well past the window: the sweep should reclaim and admit new keys.
    expect(core.consume('fresh', now + 60_000).allowed).toBe(true);
  });
});
