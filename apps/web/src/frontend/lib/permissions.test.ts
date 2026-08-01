/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { userCan } from './permissions';

describe('userCan', () => {
  it('denies everything without a user', () => {
    expect(userCan(null, 'editor.run')).toBe(false);
    expect(userCan(undefined, 'schema.browse')).toBe(false);
  });

  it('grants admins every permission even with an empty grant list', () => {
    // The local single-user stub relies on this shortcut (role admin, permissions []).
    const admin = { role: 'admin' as const, permissions: [] };
    expect(userCan(admin, 'admin.users')).toBe(true);
    expect(userCan(admin, 'editor.write')).toBe(true);
  });

  it('checks the grant list for non-admin roles', () => {
    const viewer = { role: 'viewer' as const, permissions: ['editor.run' as const] };
    expect(userCan(viewer, 'editor.run')).toBe(true);
    expect(userCan(viewer, 'editor.write')).toBe(false);
  });

  it('tolerates a malformed permissions payload', () => {
    const broken = { role: 'viewer', permissions: undefined } as unknown as {
      role: 'viewer';
      permissions: [];
    };
    expect(userCan(broken, 'editor.run')).toBe(false);
  });
});
