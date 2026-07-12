import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { rateLimit } from './rate-limit';

/** Minimal Express req/res doubles for driving the middleware. */
function reqFor(ip: string): Request {
  return { ip } as unknown as Request;
}
function resDouble(): Response & { statusCode?: number; body?: unknown; headers: Record<string, string> } {
  const res = {
    headers: {} as Record<string, string>,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown; headers: Record<string, string> };
}

describe('rateLimit', () => {
  it('allows up to `max` requests then 429s further ones from the same IP', () => {
    const limit = rateLimit({ windowMs: 60_000, max: 3 });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) limit(reqFor('1.1.1.1'), resDouble(), next);
    expect(next).toHaveBeenCalledTimes(3);

    const res = resDouble();
    limit(reqFor('1.1.1.1'), res, next);
    expect(next).toHaveBeenCalledTimes(3); // not called again
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeTruthy();
  });

  it('tracks each IP independently', () => {
    const limit = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();

    limit(reqFor('1.1.1.1'), resDouble(), next);
    const blocked = resDouble();
    limit(reqFor('1.1.1.1'), blocked, next);
    expect(blocked.statusCode).toBe(429);

    // A different IP is unaffected.
    const other = resDouble();
    limit(reqFor('2.2.2.2'), other, next);
    expect(other.statusCode).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(2); // 1.1.1.1 first hit + 2.2.2.2 first hit
  });

  it('resets the window after windowMs elapses', () => {
    vi.useFakeTimers();
    try {
      const limit = rateLimit({ windowMs: 1000, max: 1 });
      const next = vi.fn();

      limit(reqFor('9.9.9.9'), resDouble(), next);
      const blocked = resDouble();
      limit(reqFor('9.9.9.9'), blocked, next);
      expect(blocked.statusCode).toBe(429);

      vi.advanceTimersByTime(1001);
      const afterReset = resDouble();
      limit(reqFor('9.9.9.9'), afterReset, next);
      expect(afterReset.statusCode).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
