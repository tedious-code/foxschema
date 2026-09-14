/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/http/src/cookies.ts).
 */
export interface StoredCookie {
  name: string;
  value: string;
  expires?: string;
  domain?: string;
  path?: string;
}

/** Parse a Set-Cookie header value into a stored cookie (name/value + attrs). */
export function parseSetCookie(header: string): StoredCookie | undefined {
  const parts = header.split(';').map((part) => part.trim());
  const [pair, ...attrs] = parts;
  if (!pair) return undefined;
  const eq = pair.indexOf('=');
  if (eq <= 0) return undefined;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return undefined;
  const cookie: StoredCookie = { name, value };
  for (const attr of attrs) {
    const [rawKey, ...rest] = attr.split('=');
    const key = rawKey?.trim().toLowerCase();
    const attrValue = rest.join('=').trim();
    if (key === 'expires' && attrValue) cookie.expires = new Date(attrValue).toISOString();
    if (key === 'max-age' && attrValue) {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) {
        cookie.expires = new Date(Date.now() + seconds * 1000).toISOString();
      }
    }
    if (key === 'domain' && attrValue) cookie.domain = attrValue;
    if (key === 'path' && attrValue) cookie.path = attrValue;
  }
  return cookie;
}

export function mergeCookies(
  existing: StoredCookie[],
  incoming: StoredCookie[],
  now = Date.now(),
): StoredCookie[] {
  const map = new Map<string, StoredCookie>();
  for (const cookie of [...existing, ...incoming]) {
    if (cookie.expires && new Date(cookie.expires).getTime() <= now) {
      map.delete(cookie.name);
      continue;
    }
    map.set(cookie.name, cookie);
  }
  return [...map.values()];
}

export function cookiesFromSecret(
  secret: Record<string, unknown> | undefined,
): StoredCookie[] {
  if (!secret || !Array.isArray(secret.cookies)) return [];
  return secret.cookies
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      name: String(row.name ?? ''),
      value: String(row.value ?? ''),
      ...(typeof row.expires === 'string' ? { expires: row.expires } : {}),
      ...(typeof row.domain === 'string' ? { domain: row.domain } : {}),
      ...(typeof row.path === 'string' ? { path: row.path } : {}),
    }))
    .filter((row) => row.name.length > 0);
}

export function cookieHeader(
  cookies: StoredCookie[],
  now = Date.now(),
): string | undefined {
  const live = cookies.filter(
    (cookie) => !cookie.expires || new Date(cookie.expires).getTime() > now,
  );
  if (live.length === 0) return undefined;
  return live.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/** Collect Set-Cookie from fetch Headers (getSetCookie when available). */
export function collectSetCookies(headers: Headers): StoredCookie[] {
  const raw =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : multiHeader(headers, 'set-cookie');
  return raw
    .map(parseSetCookie)
    .filter((cookie): cookie is StoredCookie => cookie !== undefined);
}

function multiHeader(headers: Headers, name: string): string[] {
  const value = headers.get(name);
  return value ? [value] : [];
}
