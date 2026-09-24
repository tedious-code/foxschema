/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which browser origins may call this API with credentials.
 *
 * The API holds database credentials and can execute migrations, so only named
 * origins may call it with cookies. The allowlist is explicit rather than
 * pattern-based: trusting all of `localhost` would let a page served by any
 * other local process drive this API with the user's session cookie, and
 * `*.localhost` names can be pointed anywhere by DNS.
 *
 * These functions are pure so they can be tested without a running server.
 */

import { networkInterfaces } from 'node:os';

/** Ports the dev setup legitimately serves the UI from. */
const DEV_ORIGIN_PORTS = [5173, 5199, 3210, 3211];

/**
 * How long a snapshot of this machine's addresses is reused. The policy runs on
 * every request that carries an Origin — twice, once in the guard and once for
 * CORS — and `os.networkInterfaces()` is a synchronous syscall. A few seconds
 * still picks up a LAN address that appears mid-run (joining Wi-Fi) without
 * paying for it per request.
 */
const DEV_HOSTS_TTL_MS = 5_000;
let devHostsSnapshot: { at: number; hosts: string[] } | undefined;

function currentDevHosts(now = Date.now()): string[] {
  if (!devHostsSnapshot || now - devHostsSnapshot.at > DEV_HOSTS_TTL_MS) {
    devHostsSnapshot = { at: now, hosts: localDevHosts() };
  }
  return devHostsSnapshot.hosts;
}

/** Last computed allowlist and what it was computed from. */
let allowlistMemo: { key: string; hosts: string[] | undefined; set: Set<string> } | undefined;

/**
 * Literal addresses this machine answers on, for the dev allowlist.
 *
 * Why literal IPs and never hostnames: a page is only served from
 * `http://192.168.1.69:5173` if something on this machine served it, so an
 * Origin naming one of our own addresses is our own dev UI. A hostname proves
 * nothing — DNS rebinding points `evil.com` at 127.0.0.1, the browser treats
 * `http://evil.com:5173` as same-origin, and Vite (`allowedHosts: true`) serves
 * it. The Origin is still `http://evil.com:5173`, so it stays refused.
 *
 * This is what `npm run dev` needed. Vite binds 0.0.0.0 and prints a `Network:`
 * URL on the LAN address; opening it sent that address as Origin, which was not
 * on the list, so every API call answered 403 and the UI looked disconnected.
 */
export function localDevHosts(): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      // Link-local IPv6 carries a zone id (`fe80::1%en0`) that cannot appear in
      // an Origin, so it could never match; skip it rather than add dead entries.
      if (a.family === 'IPv6' && a.address.toLowerCase().startsWith('fe80:')) continue;
      hosts.add(a.family === 'IPv6' ? `[${a.address}]` : a.address);
    }
  }
  return [...hosts];
}

export interface OriginPolicyOptions {
  /** Comma-separated explicit allowlist. Wins over everything else. */
  allowedOrigins?: string;
  /** False outside production, where the UI and API share an origin. */
  isProduction?: boolean;
  /**
   * Hosts the dev ports are allowed on, as they appear in an Origin (`[::1]`
   * for IPv6). Defaults to `localDevHosts()`; tests pass a fixed list.
   */
  devHosts?: string[];
  /** The origin this server is reachable on, when it knows it. */
  selfOrigin?: string;
  /**
   * This request's own origin (`${protocol}://${host}`). Same-origin browser
   * `fetch` sends an `Origin` header even when UI and API share a host — Docker
   * and `foxschema open` both run that way under `NODE_ENV=production`. Matching
   * Origin to the request host keeps those working without `FOX_ALLOWED_ORIGINS`,
   * while a cross-site Origin still fails the Host match.
   */
  requestOrigin?: string;
}

function normalize(origin: string): string {
  try {
    const u = new URL(origin);
    // Compare scheme + host + port only; a path or trailing slash is noise.
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Build the set of acceptable origins.
 *
 * Explicit configuration always wins, so an operator fronting Fox Schema with a
 * real hostname can say so without editing code.
 */
export function allowedOriginSet(options: OriginPolicyOptions = {}): Set<string> {
  const allowedOrigins = options.allowedOrigins ?? process.env.FOX_ALLOWED_ORIGINS ?? '';
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  // Hosts only matter outside production; resolve them lazily so a production
  // server never touches the network interfaces at all.
  const hosts = isProduction ? undefined : (options.devHosts ?? currentDevHosts());
  const key = `${allowedOrigins}\u0000${isProduction}\u0000${options.selfOrigin ?? ''}`;
  // Same inputs as last time (the hosts array is compared by reference: the
  // snapshot keeps its identity for the TTL) → same answer, without rebuilding.
  if (allowlistMemo && allowlistMemo.key === key && allowlistMemo.hosts === hosts) {
    return allowlistMemo.set;
  }
  const set = buildAllowedOriginSet(allowedOrigins, isProduction, options.selfOrigin, hosts);
  allowlistMemo = { key, hosts, set };
  return set;
}

function buildAllowedOriginSet(
  allowedOrigins: string,
  isProduction: boolean,
  selfOrigin: string | undefined,
  hosts: string[] | undefined
): Set<string> {
  const explicit = allowedOrigins
    .split(',')
    .map((o) => normalize(o.trim()))
    .filter(Boolean);
  if (explicit.length > 0) return new Set(explicit);

  const out = new Set<string>();
  if (selfOrigin) {
    const self = normalize(selfOrigin);
    if (self) out.add(self);
  }

  if (!isProduction) {
    // Dev serves the UI and the API on different ports, so same-origin does not
    // hold and the Vite ports have to be named. Deliberately a fixed list of
    // ports, not "any localhost port", on this machine's own literal addresses
    // — see `localDevHosts` for why hostnames other than `localhost` are out.
    for (const host of hosts ?? []) {
      for (const port of DEV_ORIGIN_PORTS) out.add(`http://${host}:${port}`);
    }
  }
  return out;
}

/**
 * Decide one origin.
 *
 * A missing `Origin` is allowed: curl, health checks and some navigations send
 * none. Browsers *do* send `Origin` on same-origin `fetch` (especially POST),
 * so production single-origin deploys must also accept Origin equal to this
 * request's host — see `requestOrigin`.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  options: OriginPolicyOptions = {}
): boolean {
  if (!origin) return true;
  const normalized = normalize(origin);
  if (!normalized) return false;
  if (allowedOriginSet(options).has(normalized)) return true;
  // Same-origin SPA → API on one port (Docker, CLI open, single-origin serve).
  if (options.requestOrigin && normalize(options.requestOrigin) === normalized) {
    return true;
  }
  return false;
}

/**
 * Refuse a disallowed origin with a 403 that says so.
 *
 * The `cors` package signals refusal by throwing, which surfaces as a 500 — a
 * server fault, for what is a deliberate policy decision. Running before the
 * cors middleware turns it into an answer the caller can act on, and keeps a
 * refused cross-origin request from reaching any route.
 *
 * Transport-agnostic on purpose: it takes the origin and returns a verdict, so
 * both servers share one decision.
 */
export function originVerdict(
  origin: string | undefined,
  options: OriginPolicyOptions = {}
): { allowed: true } | { allowed: false; status: 403; error: string } {
  if (isAllowedOrigin(origin, options)) return { allowed: true };
  return {
    allowed: false,
    status: 403,
    // Deliberately does not echo the origin back — no reason to reflect
    // attacker-controlled text into a response body.
    error: 'This origin is not allowed to call the Fox Schema API.',
  };
}

/** Build `requestOrigin` from the live request (protocol honours trustProxy). */
export function requestOriginFrom(protocol: string, host: string | undefined): string | undefined {
  if (!host) return undefined;
  const proto = protocol === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}
