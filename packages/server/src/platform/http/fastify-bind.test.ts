/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for streaming responses through a bound route.
 *
 * Headers set before the first write must still reach the client, including
 * the security headers added by the server's onRequest hook — writing to the
 * raw socket bypasses Fastify's header flush, so this is the regression the
 * stream helpers exist to prevent.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { bindRoutes } from './fastify-bind';
import { Router } from './router';
import { streamEnd, streamWrite } from './reply';
import type { AppRequest } from './types';

describe('streaming responses', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** Start a server whose one route streams, with headers set beforehand. */
  async function streamingServer(handler: (req: AppRequest, res: FastifyReply) => void) {
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
      res.header('Content-Type', 'application/x-ndjson');
      res.header('Cache-Control', 'no-cache');
      streamWrite(res, JSON.stringify({ type: 'start' }) + '\n');
      streamWrite(res, JSON.stringify({ type: 'done' }) + '\n');
      streamEnd(res);
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
      res.header('Content-Type', 'application/x-ndjson');
      for (const type of ['snapshot', 'start', 'object', 'done']) {
        streamWrite(res, JSON.stringify({ type }) + '\n');
      }
      streamEnd(res);
    });

    const lines = (await (await fetch(url)).text()).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(['snapshot', 'start', 'object', 'done']);
  });

  it('honours a status set before streaming begins', async () => {
    const url = await streamingServer((_req, res) => {
      res.status(207);
      streamWrite(res, 'partial\n');
      streamEnd(res);
    });
    expect((await fetch(url)).status).toBe(207);
  });

  it('ends cleanly when a handler ends without writing', async () => {
    // streamEnd takes the socket over on its own, so an empty stream still
    // flushes the headers rather than hanging until the client times out.
    const url = await streamingServer((_req, res) => {
      res.header('Content-Type', 'application/x-ndjson');
      streamEnd(res);
    });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
