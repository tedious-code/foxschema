/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Permission guards for Express routes.
 */
import type { FastifyReply } from 'fastify';
import type { AppRequest, NextFunction } from '../../platform/http/types';
import { permissionSatisfied } from '@foxschema/shared';
import type { Permission } from '@foxschema/shared';
import type { AuthedRequest } from '../auth/auth.routes';
import { sendError } from '../../platform/http/respond';

/** After a session is resolved, reject when any required permission is missing. */
export function requirePermissions(...required: Permission[]) {
  return (req: AuthedRequest, res: FastifyReply, next: NextFunction): void => {
    if (denyUnless(req, res, ...required)) return;
    next();
  };
}

/** Returns true when the response was already sent (denied). */
export function denyUnless(
  req: AuthedRequest,
  res: FastifyReply,
  ...required: Permission[]
): boolean {
  if (!req.userId) {
    sendError(res, 'unauthenticated', 'Authentication required');
    return true;
  }
  if (req.appRole === 'admin') return false;
  const have = req.permissions ?? new Set<Permission>();
  // permissionSatisfied, not have.has: the legacy `editor.write` umbrella still
  // covers the finer dml/ddl keys for grants saved before the split.
  const missing = required.filter((p) => !permissionSatisfied(have, p));
  if (missing.length > 0) {
    sendError(res, 'forbidden', 'Permission denied', { extra: { missing } });
    return true;
  }
  return false;
}
