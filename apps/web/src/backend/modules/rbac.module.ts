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
  uniquePermissions,
} from '../../shared/permissions';

/** Unknown / missing role values fall back to the least-privileged role. */
export function toAppRole(value: unknown): AppRole {
  return isAppRole(value) ? value : 'viewer';
}

/**
 * Placeholder row so an intentionally empty grant list is distinguishable from
 * "never seeded" (which still falls back to DEFAULT_ROLE_PERMISSIONS). Filtered
 * out by uniquePermissions / isPermission — never returned to callers.
 */
const EMPTY_ROLE_PERMISSIONS_SENTINEL = '';

export class RbacModule {
  /** Permissions granted to a role (DB overlay, else built-in defaults). */
  async permissionsForRole(role: AppRole): Promise<Permission[]> {
    if (role === 'admin') return [...DEFAULT_ROLE_PERMISSIONS.admin];
    const store = await getStore();
    const rows = await store.all<{ permission: string }>(
      'SELECT permission FROM role_permissions WHERE role = ?',
      [role]
    );
    // No rows → not customized yet (or pre-seed) → built-in defaults.
    // Any row (including the empty-set sentinel) → honor the stored grant list.
    if (rows.length === 0) return [...DEFAULT_ROLE_PERMISSIONS[role]];
    return uniquePermissions(rows.map((r) => r.permission));
  }

  async setUserRole(userId: string, role: AppRole): Promise<void> {
    const store = await getStore();
    const result = await store.run('UPDATE users SET app_role = ? WHERE id = ?', [role, userId]);
    if (result.changes === 0) {
      // MySQL reports 0 affected rows for a no-op update, so this may be a
      // user who already has the role rather than a missing one.
      const exists = await store.get('SELECT id FROM users WHERE id = ?', [userId]);
      if (!exists) throw new Error('User not found.');
    }
  }

  /** Replace the permission set for a non-admin role. Admin is always full. */
  async setRolePermissions(role: AppRole, permissions: unknown[]): Promise<Permission[]> {
    if (role === 'admin') {
      throw new Error('Admin always has all permissions — nothing to configure.');
    }
    const next = uniquePermissions(permissions);
    const store = await getStore();
    await store.run('DELETE FROM role_permissions WHERE role = ?', [role]);
    if (next.length === 0) {
      // Persist a sentinel so permissionsForRole does not fail-open to defaults,
      // and seedDefaultRolePermissions does not re-fill on the next boot.
      await store.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [
        role,
        EMPTY_ROLE_PERMISSIONS_SENTINEL,
      ]);
    } else {
      for (const p of next) {
        await store.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, p]);
      }
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
      role: toAppRole(r.app_role),
      createdAt: r.created_at,
    }));
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
