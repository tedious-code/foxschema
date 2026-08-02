/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Frontend helpers for app RBAC, over the shared in-app catalog.
 */
export type { AppRole, Permission, PermissionMeta } from '../../shared/permissions';
export { APP_ROLES } from '../../shared/permissions';

import type { AppRole, Permission } from '../../shared/permissions';

export function userCan(
  user: { role: AppRole; permissions: Permission[] } | null | undefined,
  permission: Permission
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // `permissions` comes off an API payload, so don't trust the declared type.
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}
