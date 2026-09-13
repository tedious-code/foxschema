/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { FoxSchemaPlugin, PluginContext } from './index';

describe('plugin-sdk', () => {
  it('activates a stub plugin', async () => {
    const seen: string[] = [];
    const plugin: FoxSchemaPlugin = {
      id: 'demo',
      name: 'Demo',
      activate(ctx: PluginContext) {
        seen.push(ctx.workspaceId ?? 'none');
      },
    };
    await plugin.activate({ workspaceId: 'local' });
    expect(plugin.id).toBe('demo');
    expect(seen).toEqual(['local']);
  });
});
