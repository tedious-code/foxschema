import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  RateLimitCore,
  RATE_LIMIT_MESSAGE,
  rateLimitKey,
} from './rate-limit-core';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Bucket namespace, so one endpoint's flood cannot spend another's allowance. */
  name?: string;
  message?: string;
}

/**
 * Express adapter over the shared limiter.
 *
 * The sliding-window decision lives in `policy/rate-limit-core` so the Fastify
 * server enforces the identical policy during the staged migration.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, name = 'default' } = options;
  const message = options.message ?? RATE_LIMIT_MESSAGE;
  const core = new RateLimitCore({ windowMs, max });

  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = (req as { userId?: string }).userId;
    const decision = core.consume(rateLimitKey(name, userId, req.ip));

    res.setHeader('RateLimit-Limit', String(decision.limit));
    res.setHeader('RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSec));
      res.setHeader('RateLimit-Reset', String(decision.retryAfterSec));
      res.status(429).json({ ok: false, error: message });
      return;
    }
    next();
  };
}

/**
 * Outermost floodgate, mounted ahead of every `/api` sub-router.
 *
 * It has to run before the auth guards to cover them — login and signup are
 * exactly the endpoints worth limiting for unauthenticated callers — which
 * means `req.userId` is not set yet and this can only key by IP. That is the
 * right trade: this layer stops a flood, and the per-user limiter below
 * apportions a fair share.
 */
export function globalApiFloodgate(): RequestHandler {
  return rateLimit({
    name: 'api-global',
    windowMs: 60_000,
    max: Number(process.env.FOX_RATE_LIMIT_GLOBAL_MAX) || 1200,
  });
}

/**
 * Per-user limit for the routes that reach a database.
 *
 * Mounted after the guard so it can charge a session rather than an address.
 * Before this existed, 28 of the 38 routes in `createApiRoutes` had no limit at
 * all, including every one that opens a connection.
 */
export function defaultApiRateLimit(): RequestHandler {
  return rateLimit({
    name: 'api',
    windowMs: 60_000,
    max: Number(process.env.FOX_RATE_LIMIT_MAX) || 600,
  });
}
