/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapts the community RBAC catalog onto `@foxschema/rbac-contract` so
 * enterprise providers can swap in later without changing call sites.
 */
import { CommunityRbacProvider, type RbacProvider } from '@foxschema/rbac-contract';
import type { Permission } from '@foxschema/shared';

/** Build a community RbacProvider from a flat permission grant list. */
export function communityRbacProvider(permissions: Iterable<Permission>): RbacProvider {
  return new CommunityRbacProvider(new Set(permissions));
}
