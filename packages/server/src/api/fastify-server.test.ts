import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createFastifyApp } from './fastify-server';

/**
 * Parity and edge behaviour for the Fastify server.
 *
 * The point of a staged migration is that nothing changes when the server
 * swaps, so these assert the contract the Express server already meets —
 * headers, limits, JSON errors — plus the things Fastify adds at the edge that
 * Express had no answer for.
 *
 * `app.inject()` drives the full lifecycle without binding a port.
 */
describe('fastify edge', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOCAL_SINGLE_USER = 'true';
    app = await createFastifyApp({ bodyLimitBytes: 1024, requestTimeoutMs: 5000 });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('serves the API through the mounted Express routers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['referrer-policy', 'no-referrer'],
  ])('sets %s on API responses', async (header, value) => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers[header]).toBe(value);
  });

  it('forbids caching of API responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(String(res.headers['cache-control'])).toMatch(/no-store/);
  });

  it('sets headers on a 404 too — where Express middleware ordering leaves gaps', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('advertises the rate limit on API responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(Number(res.headers['ratelimit-limit'])).toBeGreaterThan(0);
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });

  it('does not rate-limit the UI routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/index.html' });
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  it('does not advertise the framework', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('fastify floodgate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LOCAL_SINGLE_USER = 'true';
    process.env.FOX_RATE_LIMIT_GLOBAL_MAX = '5';
    app = await createFastifyApp({});
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    delete process.env.FOX_RATE_LIMIT_GLOBAL_MAX;
    await app?.close();
  });

  it('blocks past the ceiling and says when to retry', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      codes.push(res.statusCode);
      if (res.statusCode === 429) {
        expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(JSON.parse(res.body).ok).toBe(false);
      }
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
  });

  it('short-circuits before the route runs at all', async () => {
    // The whole value of the hook: a flood costs nothing downstream.
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('fastify not-found', () => {
  it('answers an unknown API path with the shared error contract', async () => {
    process.env.LOCAL_SINGLE_USER = 'true';
    const app = await createFastifyApp({});
    try {
      const res = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ ok: false, code: 'not_found' });
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe('fastify body handling', () => {
  /**
   * Body-parse failures are Fastify's own now, and
   * `inject()` does not drive that bridge far enough to surface them — these go
   * over a real socket, which is also closer to what a client does. Its own
   * instance, because listening and closing would disturb the shared one.
   */
  it('answers a malformed or oversized body with JSON, not an empty response', async () => {
    process.env.LOCAL_SINGLE_USER = 'true';
    const app = await createFastifyApp({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    try {
      const malformed = await fetch(`http://127.0.0.1:${port}/api/sql/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      });
      expect(malformed.status).toBe(400);
      // This used to be an empty 400, which the UI reported as
      // "Empty response from server" for what is really a bad request.
      const malformedBody = await malformed.json();
      expect(malformedBody.ok).toBe(false);
      // Framework-level failures answer before any route runs, so they never
      // pass through sendError. They were the one class of error with no code,
      // which left a client parsing `code` special-casing exactly the responses
      // it can least predict.
      expect(malformedBody.code).toBe('invalid_input');

      // Two acceptable outcomes, and which one arrives is a race.
      //
      // Fastify aborts as soon as the declared body exceeds the limit rather
      // than reading 20MB it has already decided to reject — so the client can
      // see ECONNRESET mid-upload instead of a response. That is the better
      // server behaviour, and asserting only on the 413 made this test fail
      // whenever machine load tipped the race. Both mean "refused".
      const oversized = await fetch(`http://127.0.0.1:${port}/api/sql/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ s: 'x'.repeat(20 * 1024 * 1024) }),
      }).catch((err: unknown) => err as Error);

      if (oversized instanceof Error) {
        expect(String(oversized)).toMatch(/fetch failed|ECONNRESET|socket/i);
      } else {
        expect(oversized.status).toBe(413);
        // The limit is named, so a caller knows what to shrink to.
        expect((await oversized.json()).error).toMatch(/larger than/i);
      }
    } finally {
      await app.close();
    }
  }, 60_000);
});
