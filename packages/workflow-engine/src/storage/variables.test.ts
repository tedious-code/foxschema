/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/variables.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSqliteStores } from './index.js';

function stores() {
  return openSqliteStores(':memory:', randomBytes(32));
}

describe('environments', () => {
  it('makes the first environment active and keeps exactly one active', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    expect(dev.isActive).toBe(true);

    // Later environments are inactive unless asked for.
    const prod = await db.environments.create({ name: 'prod' });
    expect(prod.isActive).toBe(false);
    expect((await db.environments.active())?.name).toBe('dev');

    await db.environments.activate(prod.id);
    expect((await db.environments.active())?.name).toBe('prod');
    expect((await db.environments.list()).filter((e) => e.isActive)).toHaveLength(1);
    db.close();
  });

  it('rejects duplicate environment names', async () => {
    const db = stores();
    await db.environments.create({ name: 'dev' });
    await expect(db.environments.create({ name: 'dev' })).rejects.toThrow();
    db.close();
  });

  it('cascades variable deletion when an environment is removed', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    await db.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'api_base',
      value: 'https://dev.example.com',
    });
    expect(await db.environments.remove(dev.id)).toBe(true);
    expect(await db.variables.list({ environmentId: dev.id })).toEqual([]);
    db.close();
  });
});

describe('variables', () => {
  it('resolves workflow-local over global within one environment', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    await db.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'api_base',
      value: 'https://dev.example.com',
    });
    await db.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'page_size',
      value: 100,
    });
    await db.variables.put({
      environmentId: dev.id,
      scope: 'workflow',
      workflowId: 'orders',
      key: 'page_size',
      value: 500,
    });

    expect(await db.variables.resolve(dev.id, 'orders')).toEqual({
      api_base: 'https://dev.example.com',
      page_size: 500,
    });
    // A different workflow sees the global value.
    expect(await db.variables.resolve(dev.id, 'other')).toEqual({
      api_base: 'https://dev.example.com',
      page_size: 100,
    });
    db.close();
  });

  it('isolates variables between environments, same key different value', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    const prod = await db.environments.create({ name: 'prod' });
    for (const [env, value] of [
      [dev, 'https://dev.example.com'],
      [prod, 'https://api.example.com'],
    ] as const) {
      await db.variables.put({
        environmentId: env.id,
        scope: 'global',
        key: 'api_base',
        value,
      });
    }
    expect(await db.variables.resolve(dev.id, 'orders')).toEqual({
      api_base: 'https://dev.example.com',
    });
    expect(await db.variables.resolve(prod.id, 'orders')).toEqual({
      api_base: 'https://api.example.com',
    });
    db.close();
  });

  it('upserts by (environment, scope, workflow, key) instead of duplicating', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    const first = await db.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'api_base',
      value: 'one',
    });
    const second = await db.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'api_base',
      value: 'two',
    });
    expect(await db.variables.list({ environmentId: dev.id })).toHaveLength(1);
    expect(second.value).toBe('two');
    expect(second.id).toBe(first.id);
    db.close();
  });

  it('keeps global and workflow rows with the same key distinct', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    await db.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'page_size',
      value: 100,
    });
    await db.variables.put({
      environmentId: dev.id,
      scope: 'workflow',
      workflowId: 'orders',
      key: 'page_size',
      value: 500,
    });
    expect(await db.variables.list({ environmentId: dev.id })).toHaveLength(2);
    expect(
      await db.variables.list({ environmentId: dev.id, scope: 'global' }),
    ).toHaveLength(1);
    db.close();
  });

  it('rejects a workflow-scoped variable with no workflowId', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    await expect(
      db.variables.put({
        environmentId: dev.id,
        scope: 'workflow',
        key: 'oops',
        value: 1,
      }),
    ).rejects.toThrow(/requires a workflowId/);
    db.close();
  });

  it('preserves JSON value types through a round trip', async () => {
    const db = stores();
    const dev = await db.environments.create({ name: 'dev' });
    for (const [key, value] of [
      ['num', 42],
      ['bool', false],
      ['obj', { nested: [1, 2] }],
      ['nul', null],
    ] as const) {
      await db.variables.put({
        environmentId: dev.id,
        scope: 'global',
        key,
        value,
      });
    }
    expect(await db.variables.resolve(dev.id, 'any')).toEqual({
      num: 42,
      bool: false,
      obj: { nested: [1, 2] },
      nul: null,
    });
    db.close();
  });
});
