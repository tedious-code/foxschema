/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { CommunityRbacProvider, COMMUNITY_WORKSPACE_ID } from './index';

describe('CommunityRbacProvider', () => {
  it('grants only listed permissions', () => {
    const rbac = new CommunityRbacProvider(new Set(['workflow.access', 'editor.access']));
    expect(rbac.mode).toBe('community');
    expect(rbac.can('u1', 'workflow.access')).toBe(true);
    expect(rbac.can('u1', 'workflow.admin')).toBe(false);
  });

  it('rejects non-local workspace scope', () => {
    const rbac = new CommunityRbacProvider(new Set(['workflow.access']));
    expect(rbac.can('u1', 'workflow.access', { workspaceId: COMMUNITY_WORKSPACE_ID })).toBe(
      true,
    );
    expect(rbac.can('u1', 'workflow.access', { workspaceId: 'other' })).toBe(false);
  });
});
