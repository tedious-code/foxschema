import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * In-memory rate limiting for the API.
 *
 * Dependency-free on purpose — this app avoids heavyweight middleware, and the
 * counters are per-process. That makes it a floodgate rather than a precise
 * distributed quota: a multi-instance deployment gets the limit per instance.
 * Good enough for the job it does here, which is stopping one client from
 * turning a single laptop's API into a database stampede.
 *
 * Two things the previous fixed-window version got wrong:
 *
 * 1. **Boundary bursts.** A fixed window resets on a clock edge, so a caller
 *    could send `max` at the end of one window and `max` at the start of the
 *    next — twice the intended rate, in an instant. This uses a sliding window
 *    of timestamps, so the limit holds across any window-length span.
 *
 * 2. **Shared buckets.** Keying on IP alone means everyone behind one NAT — or
 *    every browser tab on a shared host — competes for the same allowance, and
 *    one heavy user locks out the rest. Authenticated requests are keyed by
 *    user id, falling back to IP only when there is no identity to use.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /**
   * Kept for callers that want a narrower bucket than the default (per-route
   * counters so one endpoint's flood does not spend another's allowance).
   */
  name?: string;
  /** Message shown to the caller when the limit is hit. */
  message?: string;
}

interface Bucket {
  /** Request timestamps inside the current window, oldest first. */
  hits: number[];
}

/** How often a full sweep may run, so a flood of distinct keys cannot grow forever. */
const SWEEP_EVERY_MS = 30_000;

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, name = 'default' } = options;
  const message = options.message ?? 'Too many requests. Please slow down and try again.';
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();

    if (now - lastSweep > SWEEP_EVERY_MS) {
      lastSweep = now;
      for (const [k, b] of buckets) {
        if (b.hits.length === 0 || now - b.hits[b.hits.length - 1] > windowMs) buckets.delete(k);
      }
    }

    const key = `${name}:${identify(req)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }

    // Drop everything that has aged out, then judge what remains.
    const cutoff = now - windowMs;
    while (bucket.hits.length > 0 && bucket.hits[0] <= cutoff) bucket.hits.shift();

    const remaining = Math.max(0, max - bucket.hits.length);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining - 1)));

    if (bucket.hits.length >= max) {
      // The oldest hit is what has to age out before there is room again.
      const retryMs = Math.max(0, bucket.hits[0] + windowMs - now);
      const retrySec = Math.max(1, Math.ceil(retryMs / 1000));
      res.setHeader('Retry-After', String(retrySec));
      res.setHeader('RateLimit-Reset', String(retrySec));
      res.setHeader('RateLimit-Remaining', '0');
      res.status(429).json({ ok: false, error: message });
      return;
    }

    bucket.hits.push(now);
    next();
  };
}

/**
 * Who to charge for this request.
 *
 * A session user is the fairest unit — it survives a changing IP and keeps one
 * noisy user from spending everyone else's allowance. IP is the fallback for
 * unauthenticated traffic, which is also the traffic most worth limiting.
 */
function identify(req: Request): string {
  const userId = (req as { userId?: string }).userId;
  if (userId) return `u:${userId}`;
  return `ip:${req.ip || 'unknown'}`;
}

/**
 * Outermost floodgate, mounted ahead of every `/api` sub-router.
 *
 * It has to run before the auth guards to cover them — login and signup are
 * exactly the endpoints worth limiting for unauthenticated callers — which
 * means `req.userId` is not set yet and this can only key by IP. That is the
 * right trade here: this layer exists to stop a flood, not to apportion a fair
 * share, and the per-user limiter below still does the latter.
 *
 * The ceiling is deliberately high: the SQL Editor and schema views are chatty,
 * and a limit normal use trips is a limit that gets removed.
 */
export function globalApiFloodgate(): RequestHandler {
  return rateLimit({
    name: 'api-global',
    windowMs: 60_000,
    max: Number(process.env.FOX_RATE_LIMIT_GLOBAL_MAX) || 1200,
    message: 'Too many requests to the Fox Schema API. Please slow down and try again.',
  });
}

/**
 * Per-user limit for the routes that reach a database.
 *
 * Mounted after the guard, so it can charge a session rather than an address —
 * one heavy user must not spend everyone else's allowance. Tighter than the
 * floodgate because each of these requests can become a database round trip.
 *
 * Before this existed, 28 of the 38 routes in `createApiRoutes` had no limit at
 * all, including every one that opens a connection.
 */
export function defaultApiRateLimit(): RequestHandler {
  return rateLimit({
    name: 'api',
    windowMs: 60_000,
    max: Number(process.env.FOX_RATE_LIMIT_MAX) || 600,
    message: 'Too many requests to the Fox Schema API. Please slow down and try again.',
  });
}
