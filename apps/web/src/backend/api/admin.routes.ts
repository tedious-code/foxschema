/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin APIs: list/assign users roles, configure role permission matrices.
 */
import { Router, Response } from 'express';
import { RbacModule } from '../modules/rbac.module';
import {
  APP_ROLES,
  PERMISSION_META,
  isAppRole,
  type AppRole,
} from '../../shared/permissions';
import type { AuthedRequest } from './auth.routes';
import { requirePermissions } from './rbac.middleware';

export function createAdminRoutes(rbac = new RbacModule()): Router {
  const router = Router();

  router.get(
    '/users',
    requirePermissions('admin.users'),
    async (_req: AuthedRequest, res: Response) => {
      res.json({ users: await rbac.listUsers(), roles: APP_ROLES });
    }
  );

  router.put(
    '/users/:id/role',
    requirePermissions('admin.users'),
    async (req: AuthedRequest, res: Response) => {
      const role = (req.body as { role?: unknown })?.role;
      if (!isAppRole(role)) {
        res.status(400).json({ error: `role must be one of: ${APP_ROLES.join(', ')}` });
        return;
      }
      const userId = String(req.params.id ?? '');
      if (!userId) {
        res.status(400).json({ error: 'User id is required.' });
        return;
      }
      // Prevent locking yourself out of the last admin accidentally — soft check.
      if (req.userId === userId && role !== 'admin') {
        const users = await rbac.listUsers();
        const otherAdmins = users.filter((u) => u.role === 'admin' && u.id !== req.userId);
        if (otherAdmins.length === 0) {
          res.status(400).json({ error: 'Cannot demote the last admin.' });
          return;
        }
      }
      try {
        await rbac.setUserRole(userId, role);
        res.json({ ok: true, userId, role });
      } catch (error: unknown) {
        res.status(404).json({ error: error instanceof Error ? error.message : 'User not found' });
      }
    }
  );

  router.get(
    '/role-permissions',
    requirePermissions('admin.roles'),
    async (_req: AuthedRequest, res: Response) => {
      res.json({
        matrix: await rbac.listRolePermissionMatrix(),
        catalog: PERMISSION_META,
        roles: APP_ROLES,
      });
    }
  );

  router.put(
    '/role-permissions/:role',
    requirePermissions('admin.roles'),
    async (req: AuthedRequest, res: Response) => {
      const role = req.params.role as AppRole;
      if (!isAppRole(role)) {
        res.status(400).json({ error: `role must be one of: ${APP_ROLES.join(', ')}` });
        return;
      }
      const permissions = (req.body as { permissions?: unknown })?.permissions;
      if (!Array.isArray(permissions)) {
        res.status(400).json({ error: 'permissions must be an array of permission ids' });
        return;
      }
      try {
        const next = await rbac.setRolePermissions(
          role,
          permissions.filter((p): p is string => typeof p === 'string')
        );
        res.json({ role, permissions: next });
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Update failed' });
      }
    }
  );

  return router;
}
