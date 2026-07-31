/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Frontend helpers for app RBAC (mirrors shared catalog).
 */
export type {
  AppRole,
  Permission,
  PermissionMeta,
} from '../../shared/permissions';
export {
  APP_ROLES,
  PERMISSIONS,
  PERMISSION_META,
  DEFAULT_ROLE_PERMISSIONS,
  isAppRole,
  isPermission,
} from '../../shared/permissions';

import type { Permission } from '../../shared/permissions';
import type { AuthUser } from '../api/authApi';

export function userCan(user: AuthUser | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function userCanAll(
  user: AuthUser | null | undefined,
  permissions: Permission[]
): boolean {
  return permissions.every((p) => userCan(user, p));
}
