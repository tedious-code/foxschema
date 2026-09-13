/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RbacProvider, RbacScope } from './types';

/**
 * Community RBAC: a flat permission set, optionally scoped to the local
 * workspace. Channel scope is ignored (community has no channels).
 */
export class CommunityRbacProvider implements RbacProvider {
  readonly mode = 'community' as const;

  constructor(private readonly permissions: ReadonlySet<string>) {}

  can(_actor: string, permission: string, scope?: RbacScope): boolean {
    if (scope?.workspaceId && scope.workspaceId !== 'local') {
      return false;
    }
    return this.permissions.has(permission);
  }
}
