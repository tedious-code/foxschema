import { describe, it, expect, beforeAll } from 'vitest';

// Use an isolated in-memory DB before anything calls getStore()
process.env.APP_DB_PATH = ':memory:';

import { RbacModule, toAppRole } from './rbac.module';
import { getStore } from '../database/store';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '../../shared/permissions';

const rbac = new RbacModule();

describe('toAppRole', () => {
  it('passes through known roles', () => {
    expect(toAppRole('admin')).toBe('admin');
    expect(toAppRole('editor')).toBe('editor');
    expect(toAppRole('viewer')).toBe('viewer');
  });

  it('falls back to viewer for unknown or missing values', () => {
    expect(toAppRole('root')).toBe('viewer');
    expect(toAppRole(null)).toBe('viewer');
    expect(toAppRole(undefined)).toBe('viewer');
    expect(toAppRole(1)).toBe('viewer');
  });
});

describe('RbacModule', () => {
  beforeAll(async () => {
    // touch the DB so migrations + default seeding run before tests
    await getStore();
  });

  it('admin always resolves to the full permission catalog', async () => {
    expect(await rbac.permissionsForRole('admin')).toEqual([...PERMISSIONS]);
  });

  it('non-admin roles resolve to their seeded defaults', async () => {
    // Reads come back in index order, so compare contents rather than order.
    expect((await rbac.permissionsForRole('viewer')).sort()).toEqual(
      [...DEFAULT_ROLE_PERMISSIONS.viewer].sort()
    );
    expect((await rbac.permissionsForRole('editor')).sort()).toEqual(
      [...DEFAULT_ROLE_PERMISSIONS.editor].sort()
    );
  });

  it('setRolePermissions replaces grants and drops unknown values', async () => {
    try {
      const next = await rbac.setRolePermissions('viewer', [
        'schema.browse',
        'schema.browse',
        'not-a-permission',
        42,
        'editor.run',
      ]);
      expect(next).toEqual(['schema.browse', 'editor.run']);
      expect((await rbac.permissionsForRole('viewer')).sort()).toEqual([
        'editor.run',
        'schema.browse',
      ]);
    } finally {
      // Restore the seeded matrix even on failure, so one red test stays one red test.
      await rbac.setRolePermissions('viewer', DEFAULT_ROLE_PERMISSIONS.viewer);
    }
  });

  it('refuses to configure the admin role', async () => {
    await expect(rbac.setRolePermissions('admin', ['editor.run'])).rejects.toThrow(
      /always has all permissions/
    );
  });

  it('setUserRole updates a user and rejects unknown ids', async () => {
    const store = await getStore();
    await store.run(
      'INSERT INTO users (id, email, password_hash, created_at, app_role) VALUES (?, ?, ?, ?, ?)',
      ['u1', 'rbac-user@example.com', 'x', new Date().toISOString(), 'viewer']
    );

    await rbac.setUserRole('u1', 'editor');
    // Assigning the same role again is a no-op update, not "user not found".
    await rbac.setUserRole('u1', 'editor');
    expect((await rbac.listUsers()).find((u) => u.id === 'u1')?.role).toBe('editor');

    await expect(rbac.setUserRole('missing', 'editor')).rejects.toThrow(/User not found/);
  });

  it('listUsers normalizes unknown stored roles to viewer', async () => {
    const store = await getStore();
    await store.run(
      'INSERT INTO users (id, email, password_hash, created_at, app_role) VALUES (?, ?, ?, ?, ?)',
      ['u2', 'legacy-role@example.com', 'x', new Date().toISOString(), 'superuser']
    );
    expect((await rbac.listUsers()).find((u) => u.id === 'u2')?.role).toBe('viewer');
  });

  it('role permission matrix covers every role', async () => {
    const matrix = await rbac.listRolePermissionMatrix();
    expect(Object.keys(matrix).sort()).toEqual(['admin', 'editor', 'viewer']);
    expect(matrix.admin).toEqual([...PERMISSIONS]);
  });
});
