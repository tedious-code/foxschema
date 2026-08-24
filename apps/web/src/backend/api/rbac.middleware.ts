/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Permission guards for Express routes.
 */
import type { Response, NextFunction } from 'express';
import { permissionSatisfied } from '../../shared/permissions';
import type { Permission } from '../../shared/permissions';
import type { AuthedRequest } from '../modules/auth/auth.routes';

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
  // permissionSatisfied, not have.has: the legacy `editor.write` umbrella still
  // covers the finer dml/ddl keys for grants saved before the split.
  const missing = required.filter((p) => !permissionSatisfied(have, p));
  if (missing.length > 0) {
    res.status(403).json({ error: 'Permission denied', missing });
    return true;
  }
  return false;
}
