/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which browser origins may call this API with credentials.
 *
 * The previous policy allowed **any** localhost origin regardless of port, plus
 * anything under `.localhost`. For this product that is a real hole rather than
 * a theoretical one: the audience runs several local dev servers at once, and
 * the API holds database credentials and can execute migrations. A page on
 * `http://localhost:1337` — or on `evil.localhost`, which attacker-controlled
 * DNS can point wherever it likes — could read and write everything using the
 * user's session cookie.
 *
 * It also defeated the usual CSRF defence: a required custom header only helps
 * when the attacker's preflight is refused, and a policy that trusts all of
 * localhost approves it.
 *
 * So the allowlist is explicit. Pure and separately testable, because an origin
 * check that is only exercised through a running server is one nobody revisits.
 */

/** Ports the dev setup legitimately serves the UI from. */
const DEV_ORIGIN_PORTS = [5173, 5199, 3210, 3211];

export interface OriginPolicyOptions {
  /** Comma-separated explicit allowlist. Wins over everything else. */
  allowedOrigins?: string;
  /** False outside production, where the UI and API share an origin. */
  isProduction?: boolean;
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
  const explicit = (options.allowedOrigins ?? process.env.FOX_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => normalize(o.trim()))
    .filter(Boolean);
  if (explicit.length > 0) return new Set(explicit);

  const out = new Set<string>();
  if (options.selfOrigin) {
    const self = normalize(options.selfOrigin);
    if (self) out.add(self);
  }

  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  if (!isProduction) {
    // Dev serves the UI and the API on different ports, so same-origin does not
    // hold and the Vite ports have to be named. Deliberately a fixed list, not
    // "any localhost port".
    for (const port of DEV_ORIGIN_PORTS) {
      out.add(`http://localhost:${port}`);
      out.add(`http://127.0.0.1:${port}`);
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

/** Express/Fastify `cors` origin callback. */
export function corsOriginDelegate(options: OriginPolicyOptions = {}) {
  return (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void): void => {
    if (isAllowedOrigin(origin, options)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  };
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
