/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Fastify edge.
 *
 * Migrating a 38-route API in one commit is how migrations break. This is the
 * staged shape instead: Fastify owns the socket and the request lifecycle, and
 * enforces every security policy natively in hooks that run before anything
 * else. The existing Express routers are mounted underneath through
 * `@fastify/express` and keep serving their paths unchanged, so no route
 * changes behaviour on the day the server swaps.
 *
 * What that buys immediately:
 *
 * - Rate limiting, security headers and idempotency move into `onRequest` /
 *   `onSend` hooks, so they apply to *every* request including 404s and
 *   malformed bodies — Express middleware ordering had already let eight
 *   sub-routers slip past a limiter once.
 * - A request timeout at the edge, which Express did not have. Note the body
 *   limit is *not* Fastify's while Express owns body parsing — the number that
 *   bites is `BODY_LIMIT` in server.ts, shared by both.
 * - Fastify's error and 404 handling, so an unhandled throw returns JSON
 *   instead of an HTML stack page.
 *
 * The policies themselves are shared with the Express server (`api/policy/*`),
 * so the two cannot drift while both exist. Selected with `FOX_SERVER=fastify`.
 *
 * ## What this does not buy: throughput
 *
 * Measured on this machine, 50 concurrent keep-alive connections against
 * /api/health:
 *
 *     express               11584 req/s   p50 3.57ms   p99 16.58ms
 *     fastify native route   7578 req/s   p50 6.21ms   p99 10.59ms
 *     fastify via express    8603 req/s   p50 4.70ms   p99 11.30ms
 *
 * Fastify is *slower* here on raw throughput, and porting a route natively did
 * not reverse that. What it does give is a materially tighter tail — p99 drops
 * by a third — which for a UI that polls health and schema endpoints matters
 * more than peak requests per second nobody is issuing.
 *
 * Recording the numbers because the reason to run this edge is the lifecycle,
 * not the speed: hooks that cannot be bypassed by mount ordering, a request
 * timeout, and JSON errors. If throughput ever becomes the reason, this comment
 * should be the first thing challenged with a fresh measurement.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyExpress from '@fastify/express';
import { createApp } from './server';
import { resolveAppVersion } from '../modules/updates.module';
import { securityHeadersFor } from './policy/security-headers-core';
import { RateLimitCore, RATE_LIMIT_MESSAGE, rateLimitKey } from './policy/rate-limit-core';

export interface FastifyServerOptions {
  /** Send HSTS. Off by default; see the header policy for why. */
  hsts?: boolean;
  /** Largest accepted request body. */
  bodyLimitBytes?: number;
  /** Abort a request that takes longer than this. */
  requestTimeoutMs?: number;
}

/**
 * Applies only to requests Fastify parses itself. While every route is served
 * through `@fastify/express`, Express's parser runs first and its limit is the
 * effective one — this becomes load-bearing as routes move to native handlers.
 */
const DEFAULT_BODY_LIMIT = 32 * 1024 * 1024;

/**
 * A request still running after this is not going to finish usefully, and it is
 * holding a socket and a database connection while it waits.
 */
const DEFAULT_REQUEST_TIMEOUT = 120_000;

export async function createFastifyApp(
  options: FastifyServerOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Behind the CLI launcher and Docker this is the local process; trusting
    // the proxy headers is what makes req.ip meaningful for rate limiting.
    trustProxy: true,
    bodyLimit: options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT,
    requestTimeout: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT,
  });

  const hsts = options.hsts ?? process.env.FOX_HSTS === '1';

  // --- Security headers, before any route can answer ----------------------
  // An onRequest hook covers 404s, rate-limit rejections and error responses,
  // which is exactly where Express middleware ordering tends to leave gaps.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    for (const [key, value] of Object.entries(securityHeadersFor(req.url.split('?')[0], { hsts }))) {
      reply.header(key, value);
    }
    reply.removeHeader('x-powered-by');
  });

  // --- Floodgate ----------------------------------------------------------
  // Ahead of every route, and ahead of the Express layer entirely, so nothing
  // mounted on a more specific path can slip past it.
  const floodgate = new RateLimitCore({
    windowMs: 60_000,
    max: Number(process.env.FOX_RATE_LIMIT_GLOBAL_MAX) || 1200,
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/api')) return;
    const decision = floodgate.consume(rateLimitKey('api-global', undefined, req.ip));
    reply.header('RateLimit-Limit', String(decision.limit));
    reply.header('RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSec));
      reply.header('RateLimit-Reset', String(decision.retryAfterSec));
      // Returning the reply short-circuits: no route, no Express, no database.
      return reply.code(429).send({ ok: false, error: RATE_LIMIT_MESSAGE });
    }
  });

  // --- Natively ported routes ---------------------------------------------
  // Registered before the Express bridge so they never touch it. This is the
  // migration path: each route moved here stops paying for two frameworks.
  // Health is first because it is trivial, has no dependencies, and is polled
  // constantly by the CLI launcher and the UI's offline banner.
  app.get('/api/health', async () => ({ ok: true, version: resolveAppVersion() }));

  // --- Express routers underneath -----------------------------------------
  // The 38 existing routes keep their handlers, their guards and their tests.
  // They move to native Fastify routes incrementally, behind this same edge.
  await app.register(fastifyExpress);
  app.use(createApp());

  // An unhandled throw must not return an HTML stack page to a JSON client.
  app.setErrorHandler((error: unknown, _req, reply) => {
    const status = (error as { statusCode?: number })?.statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Request failed.';
    reply.code(status).send({
      ok: false,
      // A 5xx must not leak internals; a 4xx is the caller's own mistake and
      // is more useful stated plainly.
      error: status >= 500 ? 'Internal server error.' : message,
    });
  });

  return app;
}
