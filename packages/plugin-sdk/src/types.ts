/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase E plugin SDK — host context and activate hook stubs.
 */

/** Host capabilities offered to a plugin (stub). */
export interface PluginContext {
  /** Workspace the plugin activates in. */
  workspaceId?: string;
  /** Optional logger hook; implementations may no-op. */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface FoxSchemaPlugin {
  id: string;
  name: string;
  activate(ctx: PluginContext): void | Promise<void>;
}
