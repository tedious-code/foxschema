/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { setCookie, clearCookie } from '../../platform/http/reply';
import type { FastifyReply } from 'fastify';
import type { AppRequest, AuthedRequest, NextFunction } from '../../platform/http/types';
import { Router } from '../../platform/http/router';
import { AuthModule, SESSION_COOKIE, SESSION_MAX_AGE_MS, type AuthUser } from '../auth/auth.service';
import { sendError } from '../../platform/http/respond';

export type { AuthedRequest };

/** Put the resolved session user's identity + grants on the request. */
export function attachAuthUser(user: AuthUser, req: AuthedRequest): void {
  req.userId = user.id;
  req.appRole = user.role;
  req.permissions = new Set(user.permissions);
}

/** Minimal cookie reader (avoids a cookie-parser dependency). */
export function readCookie(req: AppRequest, name: string): string | undefined {
  // Node types a repeated header as an array; a browser never sends Cookie
  // twice, but the type is honest and the join costs nothing.
  const raw = req.headers.cookie;
  const header = Array.isArray(raw) ? raw.join('; ') : raw;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function setSessionCookie(res: FastifyReply, token: string): void {
  setCookie(res, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
}

export function createAuthRoutes(auth: AuthModule): Router {
  const router = Router();

  router.post('/register', async (req: AppRequest, res: FastifyReply) => {
    const { email, password } = req.body as { email: string; password: string };
    try {
      const { user, token } = await auth.register(email, password);
      setSessionCookie(res, token);
      res.send({ user });
    } catch (error: unknown) {
      sendError(res, 'invalid_input', error instanceof Error ? error.message : 'Registration failed');
    }
  });

  router.post('/login', async (req: AppRequest, res: FastifyReply) => {
    const { email, password } = req.body as { email: string; password: string };
    try {
      const { user, token } = await auth.login(email, password);
      setSessionCookie(res, token);
      res.send({ user });
    } catch (error: unknown) {
      sendError(res, 'unauthenticated', error instanceof Error ? error.message : 'Login failed');
    }
  });

  router.post('/logout', async (req: AppRequest, res: FastifyReply) => {
    await auth.logout(readCookie(req, SESSION_COOKIE));
    clearCookie(res, SESSION_COOKIE, { path: '/' });
    res.send({ ok: true });
  });

  router.get('/me', async (req: AppRequest, res: FastifyReply) => {
    const user = await auth.getUserByToken(readCookie(req, SESSION_COOKIE));
    if (user) {
      res.send({ user });
      return;
    }
    // Local single-user installs have no login cookie — return the singleton
    // admin so SPA boot does not 401 (which the browser logs as a console error
    // and breaks e2e "no SEVERE console errors" checks).
    if (process.env.LOCAL_SINGLE_USER !== 'false') {
      const local = await auth.ensureLocalUser();
      res.send({ user: local });
      return;
    }
    sendError(res, 'unauthenticated', 'Not authenticated');
  });

  return router;
}

/** Guard for protected routes — attaches userId + RBAC or 401s. */
export function authGuard(auth: AuthModule) {
  return async (req: AuthedRequest, res: FastifyReply, next: NextFunction) => {
    try {
      const user = await auth.getUserByToken(readCookie(req, SESSION_COOKIE));
      if (!user) {
        sendError(res, 'unauthenticated', 'Authentication required');
        return;
      }
      attachAuthUser(user, req);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Local single-user guard: skips cookies/login and attaches the singleton
 * local user as admin so per-user routes work without an auth flow.
 */
export function localUserGuard(auth: AuthModule) {
  return async (req: AuthedRequest, _res: FastifyReply, next: NextFunction) => {
    try {
      const user = await auth.ensureLocalUser();
      attachAuthUser(user, req);
      next();
    } catch (err) {
      next(err);
    }
  };
}
