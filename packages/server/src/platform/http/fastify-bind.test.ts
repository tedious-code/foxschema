/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for cookie serialisation and streaming responses.
 *
 * Cookies: session cookies are a security boundary. A missing `HttpOnly` makes
 * the cookie readable by page scripts, and a missing `SameSite` weakens CSRF
 * protection, so each flag is asserted. `maxAge` is given in milliseconds and
 * must be emitted as seconds.
 *
 * Streaming: headers set before the first write must still reach the client,
 * including the security headers added by the server's onRequest hook.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializeCookie, bindRoutes } from './fastify-bind';
import { Router } from './router';
import type { HttpRequest, HttpResponse } from './types';

describe('serializeCookie', () => {
  it('defaults to a root path', () => {
    expect(serializeCookie('fox_session', 'abc')).toBe('fox_session=abc; Path=/');
  });

  it('carries the security flags it is given', () => {
    const cookie = serializeCookie('fox_session', 'abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api',
    });
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('omits flags that were not asked for', () => {
    // Emitting HttpOnly unasked would break a cookie the frontend reads.
    const cookie = serializeCookie('visible', 'v');
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('SameSite');
  });

  it('converts maxAge from milliseconds to seconds', () => {
    // The SSO state cookie asks for 10 minutes the way Express expressed it.
    expect(serializeCookie('sso_state', 's', { maxAge: 10 * 60 * 1000 })).toContain('Max-Age=600');
  });

  it('encodes a value that would otherwise break the header', () => {
    // A raw ';' would end the cookie and turn the rest into forged attributes.
    const cookie = serializeCookie('token', 'a;b c=d');
    expect(cookie).toContain('token=a%3Bb%20c%3Dd');
    expect(cookie.split(';')[0]).toBe('token=a%3Bb%20c%3Dd');
  });

  it('capitalises SameSite values the way browsers expect', () => {
    expect(serializeCookie('c', 'v', { sameSite: 'strict' })).toContain('SameSite=Strict');
    expect(serializeCookie('c', 'v', { sameSite: 'none' })).toContain('SameSite=None');
  });
});

describe('streaming responses', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** Start a server whose one route streams, with headers set beforehand. */
  async function streamingServer(handler: (req: HttpRequest, res: HttpResponse) => void) {
    const router = Router();
    router.get('/stream', handler);
    app = Fastify();
    // Stand in for the security-headers hook the real app installs.
    app.addHook('onRequest', async (_req, reply) => {
      reply.header('x-content-type-options', 'nosniff');
      reply.header('x-frame-options', 'DENY');
    });
    bindRoutes(app, router.flatten());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    return `http://127.0.0.1:${port}/stream`;
  }

  it('flushes headers set before the first write', async () => {
    // Writing directly to the raw socket would skip Fastify's header flush and
    // drop everything set via reply.header(), including the security headers.
    // The response body would still parse, so this is checked explicitly.
    const url = await streamingServer((_req, res) => {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache');
      res.write(JSON.stringify({ type: 'start' }) + '\n');
      res.write(JSON.stringify({ type: 'done' }) + '\n');
      res.end();
    });

    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    // The ones whose absence is a security regression, not a cosmetic one.
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('delivers every chunk in order', async () => {
    const url = await streamingServer((_req, res) => {
      res.setHeader('Content-Type', 'application/x-ndjson');
      for (const type of ['snapshot', 'start', 'object', 'done']) {
        res.write(JSON.stringify({ type }) + '\n');
      }
      res.end();
    });

    const lines = (await (await fetch(url)).text()).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(['snapshot', 'start', 'object', 'done']);
  });

  it('honours a status set before streaming begins', async () => {
    const url = await streamingServer((_req, res) => {
      res.status(207);
      res.write('partial\n');
      res.end();
    });
    expect((await fetch(url)).status).toBe(207);
  });
});
