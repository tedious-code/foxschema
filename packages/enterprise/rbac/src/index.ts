/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Enterprise RBAC stub — replace with real workspace/channel grants later.
 */
import type { RbacProvider, RbacScope } from '@foxschema/rbac-contract';

/**
 * Placeholder. `can()` always returns false until enterprise wiring lands.
 * TODO: load workspace/channel grants and evaluate against the actor.
 */
export class EnterpriseRbacProvider implements RbacProvider {
  readonly mode = 'enterprise' as const;

  can(_actor: string, _permission: string, _scope?: RbacScope): boolean {
    return false;
  }
}
