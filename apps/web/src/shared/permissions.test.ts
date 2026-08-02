/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  isAppRole,
  isPermission,
  uniquePermissions,
} from './permissions';

describe('permissions catalog', () => {
  it('defines admin/editor/viewer defaults without unknown keys', () => {
    expect(isAppRole('admin')).toBe(true);
    expect(isAppRole('guest')).toBe(false);

    for (const role of ['viewer', 'editor', 'admin'] as const) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(isPermission(p)).toBe(true);
      }
    }
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toHaveLength(PERMISSIONS.length);
  });

  it('viewer cannot migrate or write SQL; editor can', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.viewer).not.toContain('schema.migrate');
    expect(DEFAULT_ROLE_PERMISSIONS.viewer).not.toContain('editor.write');
    expect(DEFAULT_ROLE_PERMISSIONS.viewer).not.toContain('secrets.delete');
    expect(DEFAULT_ROLE_PERMISSIONS.editor).toContain('schema.migrate');
    expect(DEFAULT_ROLE_PERMISSIONS.editor).toContain('editor.write');
    expect(DEFAULT_ROLE_PERMISSIONS.editor).toContain('editor.datagrid.insert');
    expect(DEFAULT_ROLE_PERMISSIONS.editor).not.toContain('admin.users');
  });

  it('uniquePermissions drops unknowns and duplicates', () => {
    expect(uniquePermissions(['editor.run', 'nope', 'editor.run', 'schema.browse'])).toEqual([
      'editor.run',
      'schema.browse',
    ]);
  });

  it('uniquePermissions rejects non-string values from untrusted input', () => {
    expect(uniquePermissions([42, null, undefined, {}, ['editor.run'], 'editor.run'])).toEqual([
      'editor.run',
    ]);
    expect(uniquePermissions([])).toEqual([]);
  });
});
