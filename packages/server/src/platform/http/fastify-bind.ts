/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turn collected route declarations into real Fastify routes.
 *
 * Each declaration becomes one `fastify.route(...)`, with its guards as that
 * route's `preHandler` array. Nothing runs globally: a limiter attached to one
 * upload path costs zero on `/api/health`, which is exactly what the Express
 * mount could not do.
 *
 * The response object handed to a handler is an adapter over Fastify's reply,
 * implementing the `HttpResponse` subset the handlers use. Adapting rather than
 * rewriting is a deliberate trade: the HTTP contract suite can prove statuses
 * and error bodies, but success-path payloads need live database state, so
 * rewriting 80 handler bodies would have changed code nothing verifies. The
 * adapter keeps those bodies byte-identical while the framework underneath
 * changes completely.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CookieOptions, HttpRequest, HttpResponse, Middleware } from './types';
import type { RouteDefinition } from './router';

/**
 * Serialise a Set-Cookie value.
 *
 * Hand-rolled to match `readCookie`, which already avoids a cookie-parser
 * dependency on purpose. Session cookies are a security boundary, so the flags
 * are explicit and there is no library between the intent and the header.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite[0]!.toUpperCase()}${options.sameSite.slice(1)}`);
  }
  // Express takes milliseconds; Set-Cookie is seconds.
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  return parts.join('; ');
}

/** Adapter presenting a Fastify reply as the `HttpResponse` handlers expect. */
export function asHttpResponse(reply: FastifyReply): HttpResponse {
  /**
   * Streaming has to take the socket over deliberately.
   *
   * Writing straight to `reply.raw` skips Fastify's header flush, so everything
   * set through `reply.header()` is silently dropped — measured on
   * `/migration/execute`, which came back with only `Transfer-Encoding:
   * chunked`: no `Content-Type: application/x-ndjson`, no `Cache-Control`, and
   * **none of the security headers**. The response still parsed, so nothing
   * failed loudly; the endpoint was just unprotected.
   *
   * `hijack()` tells Fastify this reply is ours, and `writeHead` flushes the
   * headers it had already collected before the first chunk goes out.
   */
  let streaming = false;
  const beginStream = () => {
    if (streaming) return;
    streaming = true;
    const headers = reply.getHeaders();
    reply.hijack();
    reply.raw.writeHead(reply.statusCode, headers as Record<string, number | string | string[]>);
  };

  const res: HttpResponse = {
    status(code: number) {
      void reply.status(code);
      return res;
    },
    json(body: unknown) {
      return reply.send(body);
    },
    send(body?: unknown) {
      return reply.send(body);
    },
    setHeader(name: string, value: string) {
      void reply.header(name, value);
    },
    removeHeader(name: string) {
      void reply.removeHeader(name);
    },
    cookie(name: string, value: string, options?: CookieOptions) {
      appendCookie(reply, serializeCookie(name, value, options));
    },
    clearCookie(name: string, options?: CookieOptions) {
      // Expiring in the past is how a cookie is deleted; Max-Age 0 alone is
      // ignored by some browsers when a session cookie already exists.
      appendCookie(
        reply,
        `${serializeCookie(name, '', options)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
      );
    },
    redirect(location: string) {
      void reply.redirect(location, 302);
    },
    write(chunk: string) {
      beginStream();
      return reply.raw.write(chunk);
    },
    end() {
      beginStream();
      reply.raw.end();
    },
    get headersSent() {
      return reply.sent || reply.raw.headersSent;
    },
    get statusCode() {
      return reply.statusCode;
    },
    on(event: 'close' | 'finish', listener: () => void) {
      reply.raw.on(event, listener);
    },
  };
  return res;
}

/** Multiple Set-Cookie headers have to accumulate, not overwrite. */
function appendCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader('set-cookie');
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  void reply.header('set-cookie', [...list, cookie]);
}

/** Adapter presenting a Fastify request as the `HttpRequest` handlers expect. */
function asHttpRequest(request: FastifyRequest): HttpRequest {
  // The same object handlers mutate (userId, and the RBAC fields attached by
  // the auth guard), so decorating the Fastify request is what they observe.
  const req = request as unknown as HttpRequest & {
    path?: string;
    get?: (name: string) => string | undefined;
    originalUrl?: string;
  };
  if (req.get === undefined) {
    // Header names arrive lower-cased on Fastify; callers pass 'Idempotency-Key'.
    req.get = (name: string) => {
      const value = request.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };
  }
  if (req.originalUrl === undefined) {
    Object.defineProperty(req, 'originalUrl', { get: () => request.url, configurable: true });
  }
  // Fastify exposes the full URL; handlers that switch on the path want it
  // without the query string, which is what Express's `path` gave them.
  if (req.path === undefined) {
    Object.defineProperty(req, 'path', {
      get: () => request.url.split('?')[0]!,
      configurable: true,
    });
  }
  return req;
}

/**
 * Run a route's guards, then its handler.
 *
 * A guard signals "I answered this" by not calling `next()`, which is how the
 * Express versions already worked — so the guard bodies did not change either.
 */
async function runChain(
  middlewares: Middleware[],
  req: HttpRequest,
  res: HttpResponse
): Promise<boolean> {
  for (const mw of middlewares) {
    let proceed = false;
    let failure: unknown;
    await mw(req, res, (error?: unknown) => {
      if (error) failure = error;
      else proceed = true;
    });
    if (failure) throw failure;
    if (!proceed) return false;
  }
  return true;
}

/** Express-style `:param` paths are Fastify's syntax too, so paths pass through. */
export function bindRoutes(app: FastifyInstance, routes: RouteDefinition[]): void {
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (request, reply) => {
        const req = asHttpRequest(request);
        const res = asHttpResponse(reply);
        const proceed = await runChain(route.middlewares, req, res);
        if (!proceed) return reply;
        await route.handler(req, res);
        return reply;
      },
    });
  }
}
