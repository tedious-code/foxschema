import { describe, expect, it } from 'vitest';
import {
  APP_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_META,
  CATEGORY_PERMISSION,
  DATAGRID_ACTION_PERMISSION,
  permissionSatisfied,
  type Permission,
} from './permissions';

describe('role ladder', () => {
  it('orders roles least → most privileged', () => {
    expect(APP_ROLES).toEqual(['viewer', 'editor', 'owner', 'admin']);
  });

  it('each role is a superset of the one below it', () => {
    const has = (r: (typeof APP_ROLES)[number]) => new Set(DEFAULT_ROLE_PERMISSIONS[r]);
    for (const [lower, higher] of [['viewer', 'editor'], ['editor', 'owner'], ['owner', 'admin']] as const) {
      for (const p of has(lower)) {
        expect(has(higher).has(p), `${higher} should keep ${p} from ${lower}`).toBe(true);
      }
    }
  });

  it('editor changes data and schema but cannot grant or deploy migrations', () => {
    const editor = new Set(DEFAULT_ROLE_PERMISSIONS.editor);
    expect(editor.has('editor.dml')).toBe(true);
    expect(editor.has('editor.ddl')).toBe(true);
    expect(editor.has('editor.grant')).toBe(false);
    expect(editor.has('schema.migrate')).toBe(false);
  });

  it('owner adds privileges and migrations but not app administration', () => {
    const owner = new Set(DEFAULT_ROLE_PERMISSIONS.owner);
    expect(owner.has('editor.grant')).toBe(true);
    expect(owner.has('schema.migrate')).toBe(true);
    expect(owner.has('admin.users')).toBe(false);
    expect(owner.has('admin.roles')).toBe(false);
  });

  it('viewer stays read-only', () => {
    const viewer = new Set(DEFAULT_ROLE_PERMISSIONS.viewer);
    for (const p of ['editor.dml', 'editor.ddl', 'editor.grant', 'schema.migrate'] as Permission[]) {
      expect(viewer.has(p), p).toBe(false);
    }
  });

  it('every permission is documented', () => {
    const documented = new Set(PERMISSION_META.map((m) => m.id));
    for (const p of PERMISSIONS) expect(documented.has(p), `${p} needs PERMISSION_META`).toBe(true);
  });
});

describe('permissionSatisfied', () => {
  it('accepts the exact permission', () => {
    expect(permissionSatisfied(['editor.dml'], 'editor.dml')).toBe(true);
  });

  it('lets the legacy editor.write umbrella cover dml and ddl', () => {
    expect(permissionSatisfied(['editor.write'], 'editor.dml')).toBe(true);
    expect(permissionSatisfied(['editor.write'], 'editor.ddl')).toBe(true);
  });

  it('never lets editor.write imply editor.grant', () => {
    // grant was carved out precisely because it can escalate a role.
    expect(permissionSatisfied(['editor.write'], 'editor.grant')).toBe(false);
  });

  it('denies an unrelated permission', () => {
    expect(permissionSatisfied(['editor.dml'], 'editor.ddl')).toBe(false);
  });
});

describe('CATEGORY_PERMISSION', () => {
  it('maps each category to the right key', () => {
    expect(CATEGORY_PERMISSION.read).toBeNull();
    expect(CATEGORY_PERMISSION.dml).toBe('editor.dml');
    expect(CATEGORY_PERMISSION.ddl).toBe('editor.ddl');
    expect(CATEGORY_PERMISSION.grant).toBe('editor.grant');
  });
});

describe('DATAGRID_ACTION_PERMISSION', () => {
  it('maps grid actions to Data grid permissions', () => {
    expect(DATAGRID_ACTION_PERMISSION.insert).toBe('editor.datagrid.insert');
    expect(DATAGRID_ACTION_PERMISSION.update).toBe('editor.datagrid.update');
    expect(DATAGRID_ACTION_PERMISSION.delete).toBe('editor.datagrid.delete');
  });

  it('grants Data grid edit to the editor role by default', () => {
    const editor = new Set(DEFAULT_ROLE_PERMISSIONS.editor);
    expect(editor.has('editor.datagrid.insert')).toBe(true);
    expect(editor.has('editor.datagrid.update')).toBe(true);
    expect(editor.has('editor.datagrid.delete')).toBe(true);
  });

  it('keeps viewers off Data grid edit', () => {
    const viewer = new Set(DEFAULT_ROLE_PERMISSIONS.viewer);
    expect(viewer.has('editor.datagrid.insert')).toBe(false);
    expect(viewer.has('editor.datagrid.update')).toBe(false);
    expect(viewer.has('editor.datagrid.delete')).toBe(false);
  });
});
