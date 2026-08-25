/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The request/response shapes route handlers are written against.
 *
 * These replace the `Request`/`Response`/`NextFunction` types the handlers used
 * to import from Express. They are deliberately a *subset*: only what the 80
 * handlers in this codebase actually call. Anything Express offered that is not
 * here was not being used, and adding to this file is a decision rather than an
 * accident — which is the difference between an interface and a framework.
 *
 * Keeping the handler signature stable is the point. The Fastify port had to
 * move routing, matching and the middleware chain without touching the bodies
 * of 80 handlers, because the contract suite can only prove status codes and
 * error shapes — success-path response bodies need real database state, so a
 * hand-rewrite of every handler would have changed code that nothing verifies.
 */

/** Loosely-typed bag; handlers narrow it themselves, as they did with Express. */
export type ParamsBag = Record<string, string | undefined>;
export type QueryBag = Record<string, unknown>;

export interface HttpRequest {
  readonly method: string;
  /** Path plus query string, as received. */
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly params: ParamsBag;
  readonly query: QueryBag;
  body: unknown;
  /** Client address, honouring the trust-proxy setting. */
  readonly ip: string;
  /** Path without the query string. */
  readonly path: string;
  /** 'http' or 'https', honouring the trust-proxy setting. */
  readonly protocol: string;
  /** Case-insensitive single header lookup. */
  get(name: string): string | undefined;
  /** The URL as received, before any mounting rewrote it. */
  readonly originalUrl?: string;
  /** Set by the auth hook; absent for an unauthenticated caller. */
  userId?: string;
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
}

export interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): unknown;
  send(body?: unknown): unknown;
  setHeader(name: string, value: string): void;
  removeHeader(name: string): void;
  cookie(name: string, value: string, options?: CookieOptions): void;
  clearCookie(name: string, options?: CookieOptions): void;
  redirect(location: string): void;
  /** Streaming: NDJSON progress on long migrations writes through these. */
  write(chunk: string): boolean;
  end(): void;
  readonly headersSent: boolean;
  /** Status set so far — the idempotency guard records it when replaying. */
  readonly statusCode: number;
  /**
   * Socket lifecycle. `close` fires whether the response finished or the
   * client vanished, which is what keeps an idempotency key from wedging
   * in-flight when a handler throws.
   */
  on(event: 'close' | 'finish', listener: () => void): void;
}

export type NextFunction = (error?: unknown) => void;

/** A guard: answers the request itself, or calls `next()` to continue. */
export type Middleware = (
  req: HttpRequest,
  res: HttpResponse,
  next: NextFunction
) => void | Promise<void>;

export type RouteHandler = (req: HttpRequest, res: HttpResponse) => void | Promise<void>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
