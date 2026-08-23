import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Response hardening for the UI + API server.
 *
 * This process holds database credentials and can run migrations, so the cost
 * of a page in the user's browser reaching it is high. CORS already restricts
 * *who* may call the API; these headers reduce what an attacker can do with a
 * response they do manage to obtain, and stop the browser from making things
 * worse on our behalf.
 *
 * Written by hand rather than pulling in helmet: the app deliberately avoids
 * heavyweight middleware, and the set that actually matters here is small
 * enough to state — and to explain — in one place.
 */

export interface SecurityHeaderOptions {
  /**
   * Serving the built UI from this origin, so a CSP applies. Off for an
   * API-only process, where a CSP on JSON does nothing and the header is noise.
   */
  servesUi?: boolean;
  /**
   * Send HSTS. Off by default: this usually runs on plain-HTTP localhost, and
   * an HSTS header there can pin a developer's browser to https://localhost
   * for months — a self-inflicted outage that is awkward to undo.
   */
  hsts?: boolean;
}

export function securityHeaders(options: SecurityHeaderOptions = {}): RequestHandler {
  const { servesUi = true, hsts = false } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Stop a browser from second-guessing a JSON response into something
    // executable — the classic route from "reflected value" to script.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Nothing here is meant to be framed; clickjacking a page that can run
    // migrations is a real risk, not a theoretical one.
    res.setHeader('X-Frame-Options', 'DENY');

    // Referrers can carry connection names and object paths. Other origins
    // have no business seeing those.
    res.setHeader('Referrer-Policy', 'no-referrer');

    // None of these are used, and leaving them enabled lets embedded content
    // ask on our behalf.
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()'
    );

    // Credentials and schema data must never sit in a shared cache. Applied to
    // API responses only — the UI's static assets are meant to be cached.
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
    }

    if (hsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (servesUi && !req.path.startsWith('/api')) {
      // The UI is a bundled SPA: everything it loads is same-origin, and it
      // talks only to this server. 'unsafe-inline' for styles is required by
      // the Tailwind runtime theming, which sets CSS variables inline.
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          // Same-origin XHR plus ws: for the dev server's HMR socket.
          "connect-src 'self' ws: wss:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; ')
      );
    }

    // Version and stack are free reconnaissance.
    res.removeHeader('X-Powered-By');

    next();
  };
}
