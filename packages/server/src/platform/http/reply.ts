/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The two things Fastify's reply does not do for us.
 *
 * Handlers otherwise use `FastifyReply` directly — `send`, `status`, `header`
 * and the rest are its own API. Only cookies and taking over the socket for a
 * stream need code of ours, so only those live here.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  /** Milliseconds, as the callers already pass. Set-Cookie takes seconds. */
  maxAge?: number;
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite[0]!.toUpperCase()}${options.sameSite.slice(1)}`);
  }
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  return parts.join('; ');
}

export function setCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  options?: CookieOptions
): void {
  // `header` accumulates for set-cookie specifically, rather than replacing,
  // so two cookies on one response both survive.
  void reply.header('set-cookie', serializeCookie(name, value, options));
}

export function clearCookie(reply: FastifyReply, name: string, options?: CookieOptions): void {
  // Expiring in the past is how a cookie is deleted; Max-Age 0 alone is
  // ignored by some browsers when a session cookie already exists.
  void reply.header(
    'set-cookie',
    `${serializeCookie(name, '', options)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

/** Replies that have taken over their socket, so the takeover happens once. */
const streaming = new WeakSet<FastifyReply>();

/**
 * Take the socket over before writing to `reply.raw`.
 *
 * Writing straight to `reply.raw` skips Fastify's header flush, so anything set
 * through `reply.header()` — content type, cache control, and the security
 * headers — would never reach the client. `hijack()` hands ownership over, and
 * `writeHead` flushes what Fastify has already collected before the first
 * chunk. Calling this more than once is safe and does nothing after the first.
 */
export function beginStream(reply: FastifyReply): void {
  if (streaming.has(reply)) return;
  streaming.add(reply);
  const headers = reply.getHeaders();
  reply.hijack();
  reply.raw.writeHead(reply.statusCode, headers as Record<string, number | string | string[]>);
}

/** Write one chunk of a streamed response, taking the socket over if needed. */
export function streamWrite(reply: FastifyReply, chunk: string): boolean {
  beginStream(reply);
  return reply.raw.write(chunk);
}

/** Finish a streamed response. */
export function streamEnd(reply: FastifyReply): void {
  beginStream(reply);
  reply.raw.end();
}

/**
 * A single header by name, case-insensitively.
 *
 * Fastify lower-cases header names; callers name them as they appear on the
 * wire, such as `Idempotency-Key`.
 */
export function headerOf(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/** The path without its query string. */
export function pathOf(request: FastifyRequest): string {
  return request.url.split('?')[0]!;
}
