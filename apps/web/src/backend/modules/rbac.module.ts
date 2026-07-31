/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Role-based access control: resolve / persist role permission grants.
 */
import { getStore } from '../database/store';
import type { MetadataStore } from '../database/stores/types';
import {
  APP_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  type AppRole,
  type Permission,
  isAppRole,
  isPermission,
  uniquePermissions,
} from '../../shared/permissions';

export class RbacModule {
  /** Permissions granted to a role (DB overlay, else built-in defaults). */
  async permissionsForRole(role: AppRole): Promise<Permission[]> {
    if (role === 'admin') return [...DEFAULT_ROLE_PERMISSIONS.admin];
    const store = await getStore();
    const rows = await store.all<{ permission: string }>(
      'SELECT permission FROM role_permissions WHERE role = ?',
      [role]
    );
    if (rows.length === 0) return [...DEFAULT_ROLE_PERMISSIONS[role]];
    return uniquePermissions(rows.map((r) => r.permission));
  }

  async permissionsForUser(userId: string): Promise<{ role: AppRole; permissions: Permission[] }> {
    const role = await this.roleForUser(userId);
    return { role, permissions: await this.permissionsForRole(role) };
  }

  async roleForUser(userId: string): Promise<AppRole> {
    const store = await getStore();
    const row = await store.get<{ app_role: string | null }>(
      'SELECT app_role FROM users WHERE id = ?',
      [userId]
    );
    const role = row?.app_role;
    return isAppRole(role) ? role : 'viewer';
  }

  async setUserRole(userId: string, role: AppRole): Promise<void> {
    if (!isAppRole(role)) throw new Error('Invalid role.');
    const store = await getStore();
    const result = await store.run('UPDATE users SET app_role = ? WHERE id = ?', [role, userId]);
    if ((result as { changes?: number }).changes === 0) {
      // Some stores don't return changes — verify.
      const exists = await store.get('SELECT id FROM users WHERE id = ?', [userId]);
      if (!exists) throw new Error('User not found.');
    }
  }

  /** Replace the permission set for a non-admin role. Admin is always full. */
  async setRolePermissions(role: AppRole, permissions: string[]): Promise<Permission[]> {
    if (role === 'admin') {
      throw new Error('Admin always has all permissions — nothing to configure.');
    }
    if (!isAppRole(role)) throw new Error('Invalid role.');
    const next = uniquePermissions(permissions.filter(isPermission));
    const store = await getStore();
    await store.run('DELETE FROM role_permissions WHERE role = ?', [role]);
    for (const p of next) {
      await store.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, p]);
    }
    return next;
  }

  async listRolePermissionMatrix(): Promise<Record<AppRole, Permission[]>> {
    const out = {} as Record<AppRole, Permission[]>;
    for (const role of APP_ROLES) {
      out[role] = await this.permissionsForRole(role);
    }
    return out;
  }

  async listUsers(): Promise<Array<{ id: string; email: string; role: AppRole; createdAt: string }>> {
    const store = await getStore();
    const rows = await store.all<{
      id: string;
      email: string;
      app_role: string | null;
      created_at: string;
    }>('SELECT id, email, app_role, created_at FROM users ORDER BY created_at ASC');
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: isAppRole(r.app_role) ? r.app_role : 'viewer',
      createdAt: r.created_at,
    }));
  }

  async userHas(userId: string, permission: Permission): Promise<boolean> {
    const { role, permissions } = await this.permissionsForUser(userId);
    if (role === 'admin') return true;
    return permissions.includes(permission);
  }

  async userHasAll(userId: string, required: Permission[]): Promise<boolean> {
    if (required.length === 0) return true;
    const { role, permissions } = await this.permissionsForUser(userId);
    if (role === 'admin') return true;
    const set = new Set(permissions);
    return required.every((p) => set.has(p));
  }
}

/** Seed role_permissions with defaults when the table is empty for a role. */
export async function seedDefaultRolePermissions(store: MetadataStore): Promise<void> {
  for (const role of APP_ROLES) {
    if (role === 'admin') continue;
    const count = await store.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM role_permissions WHERE role = ?',
      [role]
    );
    if (Number(count?.n ?? 0) > 0) continue;
    for (const p of DEFAULT_ROLE_PERMISSIONS[role]) {
      await store.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, p]);
    }
  }
}
