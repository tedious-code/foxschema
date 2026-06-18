import { Router, Request, Response, NextFunction } from 'express';
import { AuthModule, SESSION_COOKIE, SESSION_MAX_AGE_MS } from '../modules/auth.module';

export interface AuthedRequest extends Request {
  userId?: string;
}

/** Minimal cookie reader (avoids a cookie-parser dependency). */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
}

export function createAuthRoutes(auth: AuthModule): Router {
  const router = Router();

  router.post('/register', (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    try {
      const { user, token } = auth.register(email, password);
      setSessionCookie(res, token);
      res.json({ user });
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Registration failed' });
    }
  });

  router.post('/login', (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    try {
      const { user, token } = auth.login(email, password);
      setSessionCookie(res, token);
      res.json({ user });
    } catch (error: unknown) {
      res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed' });
    }
  });

  router.post('/logout', (req: Request, res: Response) => {
    auth.logout(readCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req: Request, res: Response) => {
    const user = auth.getUserByToken(readCookie(req, SESSION_COOKIE));
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ user });
  });

  return router;
}

/** Guard for protected routes — attaches userId or 401s. */
export function authGuard(auth: AuthModule) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = auth.getUserByToken(readCookie(req, SESSION_COOKIE));
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.userId = user.id;
    next();
  };
}

/**
 * Local single-user guard (community desktop): skips cookies/login and attaches
 * the singleton local user, so per-user routes work without an auth flow.
 */
export function localUserGuard(auth: AuthModule) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    req.userId = auth.ensureLocalUser().id;
    next();
  };
}
