import type { HttpRequest, HttpResponse, NextFunction, Middleware } from '../platform/http/types';
import { securityHeadersFor, type SecurityHeaderOptions } from '../platform/guards/security-headers-core';

export type { SecurityHeaderOptions };

/**
 * Express adapter over the shared header policy.
 *
 * The decision lives in `policy/security-headers-core` so the Fastify server
 * applies exactly the same set — two copies of a security control is how one
 * gets a fix and the other quietly does not.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): Middleware {
  return (req: HttpRequest, res: HttpResponse, next: NextFunction): void => {
    for (const [key, value] of Object.entries(securityHeadersFor(req.path, options))) {
      res.setHeader(key, value);
    }
    // Version and stack are free reconnaissance.
    res.removeHeader('X-Powered-By');
    next();
  };
}
