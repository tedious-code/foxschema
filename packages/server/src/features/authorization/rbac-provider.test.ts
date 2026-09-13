/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS } from '@foxschema/shared';
import { communityRbacProvider } from './rbac-provider';

describe('communityRbacProvider', () => {
  it('allows permissions from the grant set in local workspace', () => {
    const rbac = communityRbacProvider(DEFAULT_ROLE_PERMISSIONS.editor);
    expect(rbac.mode).toBe('community');
    expect(rbac.can('u1', 'editor.access', { workspaceId: 'local' })).toBe(true);
    expect(rbac.can('u1', 'workflow.admin', { workspaceId: 'local' })).toBe(false);
  });

  it('rejects non-local workspace scope in community mode', () => {
    const rbac = communityRbacProvider(DEFAULT_ROLE_PERMISSIONS.admin);
    expect(rbac.can('u1', 'admin.users', { workspaceId: 'acme' })).toBe(false);
  });
});
