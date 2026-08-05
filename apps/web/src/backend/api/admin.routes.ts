/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin APIs: list/assign users roles, activate/deactivate, set passwords,
 * configure role permission matrices.
 */
import { Router, Response } from 'express';
import { RbacModule } from '../modules/rbac.module';
import { AuthModule } from '../modules/auth.module';
import { APP_ROLES, PERMISSION_META, isAppRole } from '../../shared/permissions';
import type { AuthedRequest } from './auth.routes';
import { requirePermissions } from './rbac.middleware';

export function createAdminRoutes(rbac = new RbacModule(), auth = new AuthModule()): Router {
  const router = Router();

  router.get(
    '/users',
    requirePermissions('admin.users'),
    async (_req: AuthedRequest, res: Response) => {
      res.json({ users: await rbac.listUsers() });
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

  router.put(
    '/users/:id/active',
    requirePermissions('admin.users'),
    async (req: AuthedRequest, res: Response) => {
      const userId = String(req.params.id ?? '');
      if (!userId) {
        res.status(400).json({ error: 'User id is required.' });
        return;
      }
      const active = (req.body as { active?: unknown })?.active;
      if (typeof active !== 'boolean') {
        res.status(400).json({ error: 'active must be a boolean.' });
        return;
      }
      if (req.userId === userId && active === false) {
        res.status(400).json({ error: 'Cannot deactivate your own account.' });
        return;
      }
      try {
        await rbac.setUserActive(userId, active);
        res.json({ ok: true, userId, active });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Update failed';
        res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
      }
    }
  );

  router.put(
    '/users/:id/password',
    requirePermissions('admin.users'),
    async (req: AuthedRequest, res: Response) => {
      const userId = String(req.params.id ?? '');
      if (!userId) {
        res.status(400).json({ error: 'User id is required.' });
        return;
      }
      const password = (req.body as { password?: unknown })?.password;
      if (typeof password !== 'string') {
        res.status(400).json({ error: 'password is required.' });
        return;
      }
      try {
        await auth.adminSetPassword(userId, password);
        res.json({ ok: true, userId });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Update failed';
        res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
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
      });
    }
  );

  router.put(
    '/role-permissions/:role',
    requirePermissions('admin.roles'),
    async (req: AuthedRequest, res: Response) => {
      const role = req.params.role;
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
        const next = await rbac.setRolePermissions(role, permissions);
        res.json({ role, permissions: next });
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Update failed' });
      }
    }
  );

  return router;
}
