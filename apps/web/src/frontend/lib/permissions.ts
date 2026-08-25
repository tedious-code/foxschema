/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Frontend helpers for app RBAC, over the shared in-app catalog.
 */
export type { AppRole, Permission, PermissionMeta } from '@foxschema/shared';
export { APP_ROLES } from '@foxschema/shared';

import { permissionSatisfied } from '@foxschema/shared';
import type { AppRole, Permission } from '@foxschema/shared';

export function userCan(
  user: { role: AppRole; permissions: Permission[] } | null | undefined,
  permission: Permission
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // `permissions` comes off an API payload, so don't trust the declared type.
  if (!Array.isArray(user.permissions)) return false;
  // permissionSatisfied, not includes: keeps the legacy `editor.write` umbrella
  // lighting up dml/ddl affordances exactly as the server gate does.
  return permissionSatisfied(user.permissions, permission);
}
