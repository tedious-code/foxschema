/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cookie serialisation, asserted because it replaced a library.
 *
 * `readCookie` already avoided cookie-parser deliberately, so removing Express
 * meant writing the *writing* half too. Session cookies are a security
 * boundary: a dropped `HttpOnly` is readable by any script on the page, and a
 * dropped `SameSite` re-opens the CSRF door the origin allowlist just closed.
 * Neither shows up in a status-code test.
 *
 * The Max-Age unit is the trap. Express takes milliseconds and Set-Cookie takes
 * seconds, so passing the value straight through would have turned a ten-minute
 * SSO state cookie into one lasting nearly seven days.
 */
import { describe, it, expect } from 'vitest';
import { serializeCookie } from './fastify-bind';

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
