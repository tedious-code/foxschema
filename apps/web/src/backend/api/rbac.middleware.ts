/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Permission guards for Express routes.
 */
import type { Response, NextFunction } from 'express';
import type { AuthModule, AuthUser } from '../modules/auth.module';
import type { Permission } from '../../shared/permissions';
import type { AuthedRequest } from './auth.routes';
import { readCookie } from './auth.routes';
import { SESSION_COOKIE } from '../modules/auth.module';

export function attachAuthUser(user: AuthUser, req: AuthedRequest): void {
  req.userId = user.id;
  req.appRole = user.role;
  req.permissions = new Set(user.permissions);
}

/** After a session is resolved, reject when any required permission is missing. */
export function requirePermissions(...required: Permission[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (denyUnless(req, res, ...required)) return;
    next();
  };
}

/** Returns true when the response was already sent (denied). */
export function denyUnless(
  req: AuthedRequest,
  res: Response,
  ...required: Permission[]
): boolean {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return true;
  }
  if (req.appRole === 'admin') return false;
  const have = req.permissions ?? new Set<Permission>();
  const missing = required.filter((p) => !have.has(p));
  if (missing.length > 0) {
    res.status(403).json({ error: 'Permission denied', missing });
    return true;
  }
  return false;
}

/**
 * Resolve the session user onto the request (role + permissions).
 * Use after/with authGuard / localUserGuard style flows.
 */
export function loadAuthUser(auth: AuthModule) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      if (req.userId && req.permissions && req.appRole) {
        next();
        return;
      }
      // Prefer cookie session; fall back to already-set userId (local user).
      let user = await auth.getUserByToken(readCookie(req, SESSION_COOKIE));
      if (!user && req.userId) {
        // Local single-user: ensureLocalUser was used — re-fetch by id via ensure.
        user = await auth.ensureLocalUser();
        if (user.id !== req.userId) {
          // Still attach permissions for the attached id via ensureLocalUser only.
        }
      }
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      attachAuthUser(user, req);
      next();
    } catch (err) {
      next(err);
    }
  };
}
