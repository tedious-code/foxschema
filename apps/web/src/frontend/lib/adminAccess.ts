/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Access control panel helpers: dirty drafts and last-admin / single-user locks.
 */
import type { AppRole, Permission } from '../../shared/permissions';

export function permissionSetEqual(
  a: Iterable<Permission> | undefined,
  b: Iterable<Permission> | undefined
): boolean {
  const as = a instanceof Set ? a : new Set(a ?? []);
  const bs = b instanceof Set ? b : new Set(b ?? []);
  if (as.size !== bs.size) return false;
  for (const p of as) {
    if (!bs.has(p)) return false;
  }
  return true;
}

export type AdminUserLike = {
  id: string;
  role: AppRole;
  active: boolean;
};

export function isActiveAdmin(user: AdminUserLike): boolean {
  return user.role === 'admin' && user.active !== false;
}

export function activeAdminCount(users: readonly AdminUserLike[]): number {
  return users.filter(isActiveAdmin).length;
}

export type ControlLock = { disabled: boolean; reason?: string };

export function userRoleSelectLock(
  user: AdminUserLike,
  opts: { busy?: boolean; localSingleUser?: boolean; users: readonly AdminUserLike[] }
): ControlLock {
  if (opts.busy) return { disabled: true };
  if (opts.localSingleUser) {
    return {
      disabled: true,
      reason:
        'Single-user mode keeps this account as admin. Enable multi-user login to change roles.',
    };
  }
  if (isActiveAdmin(user) && activeAdminCount(opts.users) <= 1) {
    return { disabled: true, reason: 'Cannot change the last active admin’s role' };
  }
  return { disabled: false };
}

export function userActiveCheckboxLock(
  user: AdminUserLike,
  opts: {
    busy?: boolean;
    meId?: string;
    localSingleUser?: boolean;
    users: readonly AdminUserLike[];
  }
): ControlLock {
  if (opts.busy) return { disabled: true };
  if (opts.localSingleUser) {
    return {
      disabled: true,
      reason: 'Single-user mode cannot deactivate this account.',
    };
  }
  if (user.id === opts.meId) {
    return { disabled: true, reason: 'You cannot deactivate your own account' };
  }
  if (isActiveAdmin(user) && activeAdminCount(opts.users) <= 1) {
    return { disabled: true, reason: 'Cannot deactivate the last active admin' };
  }
  return { disabled: false };
}
