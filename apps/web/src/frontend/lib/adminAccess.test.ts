/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  activeAdminCount,
  permissionSetEqual,
  userActiveCheckboxLock,
  userRoleSelectLock,
} from './adminAccess';
import type { AdminUserLike } from './adminAccess';

const admin: AdminUserLike = { id: 'a', role: 'admin', active: true };
const editor: AdminUserLike = { id: 'e', role: 'editor', active: true };
const inactiveAdmin: AdminUserLike = { id: 'ia', role: 'admin', active: false };

describe('permissionSetEqual', () => {
  it('treats the same ids as equal regardless of order', () => {
    expect(permissionSetEqual(['editor.run', 'editor.dml'], ['editor.dml', 'editor.run'])).toBe(
      true
    );
  });

  it('detects a missing or extra permission', () => {
    expect(permissionSetEqual(['editor.run'], ['editor.run', 'editor.dml'])).toBe(false);
    expect(permissionSetEqual(['editor.run'], [])).toBe(false);
  });
});

describe('last-admin / single-user locks', () => {
  it('counts only active admins', () => {
    expect(activeAdminCount([admin, editor, inactiveAdmin])).toBe(1);
    expect(activeAdminCount([admin, { ...admin, id: 'a2' }])).toBe(2);
  });

  it('locks the local singleton role and Active checkbox', () => {
    const role = userRoleSelectLock(admin, { localSingleUser: true, users: [admin] });
    expect(role.disabled).toBe(true);
    expect(role.reason).toMatch(/single-user/i);

    const active = userActiveCheckboxLock(admin, {
      localSingleUser: true,
      meId: admin.id,
      users: [admin],
    });
    expect(active.disabled).toBe(true);
    expect(active.reason).toMatch(/single-user/i);
  });

  it('locks the last active admin’s role even in multi-user mode', () => {
    const lock = userRoleSelectLock(admin, { users: [admin, editor] });
    expect(lock.disabled).toBe(true);
    expect(lock.reason).toMatch(/last active admin/i);
  });

  it('lets a second admin change an editor, and the other admin', () => {
    const otherAdmin: AdminUserLike = { id: 'a2', role: 'admin', active: true };
    expect(userRoleSelectLock(editor, { users: [admin, otherAdmin, editor] }).disabled).toBe(
      false
    );
    expect(userRoleSelectLock(otherAdmin, { users: [admin, otherAdmin] }).disabled).toBe(false);
  });

  it('does not let you deactivate yourself or the last admin', () => {
    expect(
      userActiveCheckboxLock(admin, { meId: admin.id, users: [admin, editor] }).disabled
    ).toBe(true);
    expect(userActiveCheckboxLock(admin, { meId: editor.id, users: [admin, editor] }).disabled).toBe(
      true
    );
    const otherAdmin: AdminUserLike = { id: 'a2', role: 'admin', active: true };
    expect(
      userActiveCheckboxLock(otherAdmin, { meId: admin.id, users: [admin, otherAdmin] }).disabled
    ).toBe(false);
  });
});
