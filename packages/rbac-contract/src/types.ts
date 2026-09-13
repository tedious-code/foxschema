/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Deployment mode for the RBAC provider. */
export type RbacMode = 'community' | 'enterprise';

export interface RbacScope {
  workspaceId?: string;
  channelId?: string;
}

/**
 * Capability check used by nav filtering and future API guards.
 * `actor` and `permission` stay opaque strings at this layer so enterprise
 * packages can extend without forcing shared permission enums here.
 */
export interface RbacProvider {
  readonly mode: RbacMode;
  can(actor: string, permission: string, scope?: RbacScope): boolean;
}

/** Implicit community workspace id (matches workflow-contract). */
export const COMMUNITY_WORKSPACE_ID = 'local';
