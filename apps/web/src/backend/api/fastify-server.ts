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
 * ## Performance, measured
 *
 * 50 concurrent keep-alive connections, load generator in its own process:
 *
 *     fastify, no express bridge     53474 req/s   p50 0.82ms   p99 2.50ms
 *     express                        15209 req/s   p50 2.80ms   p99 9.15ms
 *     fastify + express bridge        6786 req/s   p50 5.42ms   p99 11.10ms
 *
 * Fastify itself is ~3.5x Express on this route. The bridge is what costs:
 * `app.use()` runs Express's whole middleware chain on every request, native
 * routes included, and that alone is an 8x drop.
 *
 * So this edge is currently *slower* than plain Express, and the migration only
 * pays once routes become native handlers. That is the honest trade for having
 * hooks that mount ordering cannot bypass, a request timeout, and JSON errors —
 * and it is why `FOX_SERVER` defaults to express.
 *
 * An earlier in-process benchmark reported Fastify as slower with a *better*
 * tail. Both halves were artifacts of the client sharing the server's event
 * loop; anyone re-measuring should keep the load generator in its own process.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { BODY_LIMIT, createApp } from './server';
import { loggerConfig } from '../platform/logger/logger';
import { resolveAppVersion } from '../modules/updates.module';
import { securityHeadersFor } from '../platform/guards/security-headers-core';
import { RateLimitCore, RATE_LIMIT_MESSAGE, rateLimitKey } from '../platform/guards/rate-limit-core';

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
/**
 * The edge must not be looser than the layer behind it.
 *
 * Fastify defaulted to 32MB while Express enforced FOX_BODY_LIMIT (10mb), so a
 * 20MB body passed the edge and was rejected deeper in — surfacing as a 400
 * about bad JSON rather than the 413 it actually was. One limit, enforced
 * where the bytes arrive.
 */
function parseByteSize(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value.trim());
  if (!m) return 10 * 1024 * 1024;
  const scale = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[
    (m[2] ?? 'b').toLowerCase() as 'b' | 'kb' | 'mb' | 'gb'
  ];
  return Math.floor(Number(m[1]) * scale);
}

const DEFAULT_BODY_LIMIT = parseByteSize(BODY_LIMIT);

/**
 * A request still running after this is not going to finish usefully, and it is
 * holding a socket and a database connection while it waits.
 */
const DEFAULT_REQUEST_TIMEOUT = 120_000;

export async function createFastifyApp(
  options: FastifyServerOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    // Fastify owns the logger, which is what gives every line a request id
    // without a correlation mechanism of our own.
    logger: loggerConfig(),
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
  // `silent` because the CLI launcher and the UI's offline banner poll this
  // constantly; at info it would be most of the log volume and none of the
  // signal.
  app.get('/api/health', { logLevel: 'silent' }, async () => ({
    ok: true,
    version: resolveAppVersion(),
  }));

  // --- Express routers underneath -----------------------------------------
  // Reached only when Fastify has no route for the path, so a ported route
  // pays nothing for the ones that have not moved yet. `app.use()` would run
  // Express's whole middleware chain on every request instead — measured at
  // 6.8k req/s against 53k for the same route without it.
  //
  // The catch that broke this before: Fastify parses the body first, so
  // Express's parser found an empty stream and every POST returned 500. The
  // fix is to hand Express the already-parsed body and mark it parsed —
  // body-parser skips when `_body` is set, which is exactly what that flag is
  // for.
  const expressApp = createApp();
  app.setNotFoundHandler((req, reply) => {
    const raw = req.raw as unknown as { body?: unknown; _body?: boolean };
    if (req.body !== undefined) {
      raw.body = req.body;
      raw._body = true;
    }
    expressApp(req.raw, reply.raw);
  });

  // An unhandled throw must not return an HTML stack page to a JSON client.
  // The single place a request failure is logged. The database layer reports
  // timings at debug and re-throws; logging there as well would turn one
  // failure into several lines saying the same thing.
  app.setErrorHandler((error: unknown, req, reply) => {
    const code = (error as { statusCode?: number })?.statusCode ?? 500;
    // A 4xx is the caller's mistake, not a server failure — logging those at
    // error makes the level meaningless.
    if (code >= 500) {
      req.log.error({ err: error, method: req.method, url: req.url }, 'request failed');
    } else {
      req.log.debug({ err: error, method: req.method, url: req.url }, 'request rejected');
    }
    return errorReply(error, reply);
  });

  function errorReply(error: unknown, reply: FastifyReply) {
    const status = (error as { statusCode?: number })?.statusCode ?? 500;
    const errCode = (error as { code?: string })?.code;
    // Fastify's own text is "Request body is too large", which does not say
    // what "too large" is. Naming the limit is the difference between an error
    // a caller can act on and one they have to go looking for.
    const message =
      errCode === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? `Request body is larger than the ${BODY_LIMIT} limit.`
        : error instanceof Error
          ? error.message
          : 'Request failed.';
    reply.code(status).send({
      ok: false,
      // A 5xx must not leak internals; a 4xx is the caller's own mistake and
      // is more useful stated plainly.
      error: status >= 500 ? 'Internal server error.' : message,
    });
  }

  return app;
}
