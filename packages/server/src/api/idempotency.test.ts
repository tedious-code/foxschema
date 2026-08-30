import type { FastifyReply } from 'fastify';
import type { AppRequest } from '../platform/http/types';
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { idempotency } from '../platform/guards/idempotency';

function reqOf(key: string | undefined, body: unknown, url = '/sql/execute'): AppRequest {
  return {
    url,
    body,
    headers: key === undefined ? {} : { 'idempotency-key': key },
  } as unknown as AppRequest;
}

/**
 * A reply stand-in.
 *
 * `raw` is the emitter, because the guard settles on the raw socket's `finish`
 * and `close` — a streamed response never calls `send`, and that is the case
 * that wedges a key if it is missed.
 */
function resOf() {
  const raw = new EventEmitter();
  const res = {
    raw,
    statusCode: 200,
    headers: {} as Record<string, string>,
    sent: undefined as unknown,
    header(k: string, v: string) { res.headers[k] = v; return res; },
    status(code: number) { res.statusCode = code; return res; },
    send(payload: unknown) { res.sent = payload; return res; },
  };
  return res as unknown as FastifyReply & {
    statusCode: number; headers: Record<string, string>; sent: unknown;
    raw: EventEmitter;
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
    const next1 = vi.fn(() => { first.status(200).send({ ok: true, ran: 1 }); });
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
    mw(reqOf('k', { a: 1 }), first, () => { first.status(207).send({ partial: true }); });
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
      finish = () => first.status(200).send({ ok: true });
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
      first.status(200).send({ ok: true });
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
    mw(reqOf('k', { a: 1 }, '/sql/execute'), first, () => { first.status(200).send({ a: true }); });
    const second = resOf();
    mw(reqOf('k', { a: 1 }, '/migration/apply'), second, vi.fn());
    expect(second.statusCode).toBe(422);
  });

  it('does not wedge the key when the request dies without responding', async () => {
    // Otherwise every later attempt hangs behind a request that will never answer.
    const mw = idempotency();
    const first = resOf();
    mw(reqOf('k', { a: 1 }), first, vi.fn());
    first.raw.emit('close');
    await tick();

    const retry = resOf();
    const next = vi.fn();
    mw(reqOf('k', { a: 1 }), retry, next);
    // The key is free again, so the retry is allowed to actually run.
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('remembers a streamed response that never called json()', async () => {
    // /migration/execute writes NDJSON and ends the socket. If finish does not
    // settle the key, close frees it and a retry re-applies the migration.
    const mw = idempotency();
    const body = { steps: [{ action: 'create', objectName: 't' }] };
    const first = resOf();
    const next1 = vi.fn(() => {
      first.statusCode = 200;
      first.raw.emit('finish');
      first.raw.emit('close');
    });
    mw(reqOf('mig', body, '/migration/execute'), first, next1);
    expect(next1).toHaveBeenCalledTimes(1);
    await tick();

    const second = resOf();
    const next2 = vi.fn();
    mw(reqOf('mig', body, '/migration/execute'), second, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(second.sent).toEqual({ ok: true, streamed: true });
    expect(second.headers['Idempotency-Replayed']).toBe('true');
  });

  it('answers waiters when the original dies mid-flight', async () => {
    const mw = idempotency();
    const first = resOf();
    mw(reqOf('k', { a: 1 }), first, vi.fn());

    const waiter = resOf();
    mw(reqOf('k', { a: 1 }), waiter, vi.fn());
    expect(waiter.sent).toBeUndefined();

    first.raw.emit('close');
    await tick();
    // A waiter left hanging forever would be worse than an error.
    expect(waiter.statusCode).toBe(500);
  });

  it('expires a remembered response after its TTL', () => {
    vi.useFakeTimers();
    try {
      const mw = idempotency({ ttlMs: 1000 });
      const first = resOf();
      mw(reqOf('k', { a: 1 }), first, () => { first.status(200).send({ ok: true }); });

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
