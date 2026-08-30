/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the cookie helpers, over a real reply.
 *
 * Session cookies are a security boundary: a missing `HttpOnly` makes the
 * cookie readable by page scripts and a missing `SameSite` weakens CSRF
 * protection, so each flag is asserted. The header is read off an actual
 * response rather than a returned string, because the mistake worth catching
 * is a second cookie overwriting the first — which only shows up on the wire.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { clearCookie, setCookie } from './reply';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Run a handler on a real server and hand back its Set-Cookie headers. */
async function cookiesFrom(handler: (reply: FastifyReply) => void): Promise<string[]> {
  app = Fastify();
  app.get('/c', async (_req, reply) => {
    handler(reply);
    return reply.send({ ok: true });
  });
  const res = await app.inject({ method: 'GET', url: '/c' });
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}

const oneCookie = async (handler: (reply: FastifyReply) => void): Promise<string> =>
  (await cookiesFrom(handler))[0]!;

describe('setCookie', () => {
  it('defaults to a root path', async () => {
    expect(await oneCookie((r) => setCookie(r, 'fox_session', 'abc'))).toBe(
      'fox_session=abc; Path=/'
    );
  });

  it('carries the security flags it is given', async () => {
    const cookie = await oneCookie((r) =>
      setCookie(r, 'fox_session', 'abc', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api',
      })
    );
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('omits flags that were not asked for', async () => {
    // Emitting HttpOnly unasked would break a cookie the frontend reads.
    const cookie = await oneCookie((r) => setCookie(r, 'visible', 'v'));
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('SameSite');
  });

  it('converts maxAge from milliseconds to seconds', async () => {
    // The SSO state cookie asks for 10 minutes the way the callers express it.
    const cookie = await oneCookie((r) =>
      setCookie(r, 'sso_state', 's', { maxAge: 10 * 60 * 1000 })
    );
    expect(cookie).toContain('Max-Age=600');
  });

  it('encodes a value that would otherwise break the header', async () => {
    // A raw ';' would end the cookie and turn the rest into forged attributes.
    const cookie = await oneCookie((r) => setCookie(r, 'token', 'a;b c=d'));
    expect(cookie).toContain('token=a%3Bb%20c%3Dd');
    expect(cookie.split(';')[0]).toBe('token=a%3Bb%20c%3Dd');
  });

  it.each([
    ['strict', 'SameSite=Strict'],
    ['none', 'SameSite=None'],
  ] as const)('capitalises sameSite %s the way browsers expect', async (value, expected) => {
    expect(await oneCookie((r) => setCookie(r, 'c', 'v', { sameSite: value }))).toContain(expected);
  });

  it('sends both cookies when a handler sets two', async () => {
    // Set-Cookie is the one header that must repeat rather than replace: the
    // SSO callback sets the state cookie and the session cookie together, and
    // overwriting would silently sign the user out.
    const cookies = await cookiesFrom((r) => {
      setCookie(r, 'fox_session', 'a', { httpOnly: true });
      setCookie(r, 'fox_csrf', 'b');
    });
    expect(cookies).toHaveLength(2);
    expect(cookies.map((c) => c.split('=')[0])).toEqual(['fox_session', 'fox_csrf']);
  });
});

describe('clearCookie', () => {
  it('expires in the past, which is what actually deletes it', async () => {
    // Max-Age=0 alone is ignored by some browsers when a session cookie exists.
    const cookie = await oneCookie((r) => clearCookie(r, 'fox_session', { path: '/' }));
    expect(cookie).toContain('fox_session=;');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });
});
