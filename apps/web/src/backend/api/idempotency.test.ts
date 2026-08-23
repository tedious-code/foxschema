import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { idempotency } from './idempotency';

function reqOf(key: string | undefined, body: unknown, url = '/sql/execute'): Request {
  return {
    originalUrl: url,
    url,
    body,
    get: (h: string) => (h.toLowerCase() === 'idempotency-key' ? key : undefined),
  } as unknown as Request;
}

function resOf() {
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 200,
    headers: {} as Record<string, string>,
    sent: undefined as unknown,
    setHeader(k: string, v: string) { res.headers[k] = v; },
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.sent = payload; return res; },
  });
  return res as unknown as Response & {
    statusCode: number; headers: Record<string, string>; sent: unknown;
    emit(e: string): boolean;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('idempotency', () => {
  it('is opt-in — no key behaves exactly as before', () => {
    const mw = idempotency();
    const next = vi.fn();
    mw(reqOf(undefined, { a: 1 }), resOf(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('runs the first request and replays the response to a repeat', () => {
    const mw = idempotency();
    const body = { statements: ['DROP TABLE t'] };

    const first = resOf();
    const next1 = vi.fn(() => { first.status(200).json({ ok: true, ran: 1 }); });
    mw(reqOf('k1', body), first, next1);
    expect(next1).toHaveBeenCalledTimes(1);

    const second = resOf();
    const next2 = vi.fn();
    mw(reqOf('k1', body), second, next2);
    // The handler must not run twice — that is the whole point.
    expect(next2).not.toHaveBeenCalled();
    expect(second.sent).toEqual({ ok: true, ran: 1 });
    expect(second.headers['Idempotency-Replayed']).toBe('true');
  });

  it('preserves the original status code on replay', () => {
    const mw = idempotency();
    const first = resOf();
    mw(reqOf('k', { a: 1 }), first, () => { first.status(207).json({ partial: true }); });
    const second = resOf();
    mw(reqOf('k', { a: 1 }), second, vi.fn());
    expect(second.statusCode).toBe(207);
  });

  it('holds a duplicate that arrives mid-flight, then answers it', async () => {
    // Returning "in progress" would send the caller away to retry, which is
    // exactly the behaviour this exists to prevent.
    const mw = idempotency();
    const body = { statements: ['ALTER TABLE t ADD c int'] };

    const first = resOf();
    let finish!: () => void;
    mw(reqOf('k', body), first, () => {
      finish = () => first.status(200).json({ ok: true });
    });

    const second = resOf();
    const next2 = vi.fn();
    mw(reqOf('k', body), second, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(second.sent).toBeUndefined(); // still waiting

    finish();
    await tick();
    expect(second.sent).toEqual({ ok: true });
    expect(second.headers['Idempotency-Replayed']).toBe('true');
  });

  it('rejects a key reused for a different body', () => {
    // Replaying the first response here would hide a real client bug — and
    // could hand back a result for something the caller never asked for.
    const mw = idempotency();
    const first = resOf();
    mw(reqOf('same-key', { statements: ['SELECT 1'] }), first, () => {
      first.status(200).json({ ok: true });
    });

    const second = resOf();
    const next = vi.fn();
    mw(reqOf('same-key', { statements: ['DROP TABLE users'] }), second, next);
    expect(next).not.toHaveBeenCalled();
    expect(second.statusCode).toBe(422);
  });

  it('treats the same key on a different route as a different request', () => {
    const mw = idempotency();
    const first = resOf();
    mw(reqOf('k', { a: 1 }, '/sql/execute'), first, () => { first.status(200).json({ a: true }); });
    const second = resOf();
    mw(reqOf('k', { a: 1 }, '/migration/apply'), second, vi.fn());
    expect(second.statusCode).toBe(422);
  });

  it('does not wedge the key when the request dies without responding', async () => {
    // Otherwise every later attempt hangs behind a request that will never answer.
    const mw = idempotency();
    const first = resOf();
    mw(reqOf('k', { a: 1 }), first, vi.fn());
    first.emit('close');
    await tick();

    const retry = resOf();
    const next = vi.fn();
    mw(reqOf('k', { a: 1 }), retry, next);
    // The key is free again, so the retry is allowed to actually run.
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('answers waiters when the original dies mid-flight', async () => {
    const mw = idempotency();
    const first = resOf();
    mw(reqOf('k', { a: 1 }), first, vi.fn());

    const waiter = resOf();
    mw(reqOf('k', { a: 1 }), waiter, vi.fn());
    expect(waiter.sent).toBeUndefined();

    first.emit('close');
    await tick();
    // A waiter left hanging forever would be worse than an error.
    expect(waiter.statusCode).toBe(500);
  });

  it('expires a remembered response after its TTL', () => {
    vi.useFakeTimers();
    try {
      const mw = idempotency({ ttlMs: 1000 });
      const first = resOf();
      mw(reqOf('k', { a: 1 }), first, () => { first.status(200).json({ ok: true }); });

      vi.advanceTimersByTime(1001);
      const later = resOf();
      const next = vi.fn();
      mw(reqOf('k', { a: 1 }), later, next);
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an absurdly long key rather than storing it', () => {
    const mw = idempotency();
    const res = resOf();
    const next = vi.fn();
    mw(reqOf('x'.repeat(201), { a: 1 }), res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
