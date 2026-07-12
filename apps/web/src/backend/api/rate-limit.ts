import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Minimal in-memory, per-IP fixed-window rate limiter — dependency-free (this
 * app deliberately avoids heavyweight middleware). Suited to a low-traffic
 * endpoint whose abuse fans out to an external side effect (e.g. the signup
 * webhook's WordPress post + notification email). Not a distributed limiter:
 * counters live in this process, so a multi-instance deployment gets the limit
 * per instance — good enough as a floodgate, not a precise quota.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();

    // Opportunistic sweep so the map can't grow without bound under a flood of
    // distinct IPs — only runs once the map is already large.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }

    const key = req.ip || 'unknown';
    const entry = hits.get(key);

    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
      return;
    }

    entry.count++;
    next();
  };
}
