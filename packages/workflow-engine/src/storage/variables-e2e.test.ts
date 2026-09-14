/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/variables-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine, parseWorkflow, type WorkflowDef } from '../index.js';

/**
 * Variables end-to-end through the real Engine: resolved at admission from the
 * active (or overridden) environment, frozen onto the run, and readable by
 * pipes via `context.variables`.
 */

function engineFor(): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'variables-e2e',
  });
}

function workflow(id: string): WorkflowDef {
  return parseWorkflow({
    id,
    name: id,
    triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
    pipelines: [
      {
        id: 'main',
        name: 'main',
        pipes: [
          { id: 'src', role: 'source', type: 'source.triggerPayload', config: {} },
        ],
        edges: [],
      },
    ],
  });
}

describe('variables end-to-end', () => {
  it('snapshots resolved variables onto the run (global + workflow-local)', async () => {
    const engine = engineFor();
    const dev = await engine.stores.environments.create({ name: 'dev' });
    await engine.stores.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'api_base',
      value: 'https://dev.example.com',
    });
    await engine.stores.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'page_size',
      value: 100,
    });
    await engine.stores.variables.put({
      environmentId: dev.id,
      scope: 'workflow',
      workflowId: 'orders',
      key: 'page_size',
      value: 500,
    });

    const wf = workflow('orders');
    await engine.stores.workflows.put(wf);
    const { run } = await engine.scheduler.enqueue(wf);
    await engine.idle();

    const stored = await engine.stores.runs.get(run!.id);
    expect(stored?.environmentId).toBe(dev.id);
    expect(stored?.variables).toEqual({
      api_base: 'https://dev.example.com',
      page_size: 500,
    });
    engine.close();
  });

  it('uses the active environment, and a per-run override by name', async () => {
    const engine = engineFor();
    const dev = await engine.stores.environments.create({ name: 'dev' });
    const prod = await engine.stores.environments.create({ name: 'prod' });
    for (const [env, base] of [
      [dev, 'https://dev.example.com'],
      [prod, 'https://api.example.com'],
    ] as const) {
      await engine.stores.variables.put({
        environmentId: env.id,
        scope: 'global',
        key: 'api_base',
        value: base,
      });
    }

    const wf = workflow('orders');
    await engine.stores.workflows.put(wf);

    // No override → active environment (dev, the first created).
    const first = await engine.scheduler.enqueue(wf);
    await engine.idle();
    expect((await engine.stores.runs.get(first.run!.id))?.variables).toEqual({
      api_base: 'https://dev.example.com',
    });

    // Override by name for this run only.
    const second = await engine.scheduler.enqueue(wf, undefined, {
      environment: 'prod',
    });
    await engine.idle();
    expect((await engine.stores.runs.get(second.run!.id))?.variables).toEqual({
      api_base: 'https://api.example.com',
    });
    expect((await engine.stores.runs.get(second.run!.id))?.environmentId).toBe(
      prod.id,
    );
    engine.close();
  });

  it('rejects an unknown environment override instead of silently defaulting', async () => {
    const engine = engineFor();
    await engine.stores.environments.create({ name: 'dev' });
    const wf = workflow('orders');
    await engine.stores.workflows.put(wf);

    await expect(
      engine.scheduler.enqueue(wf, undefined, { environment: 'staging' }),
    ).rejects.toThrow(/unknown environment: staging/);
    expect(await engine.stores.runs.list()).toEqual([]);
    engine.close();
  });

  it('keeps the run snapshot stable when variables change afterwards', async () => {
    const engine = engineFor();
    const dev = await engine.stores.environments.create({ name: 'dev' });
    await engine.stores.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'api_base',
      value: 'original',
    });
    const wf = workflow('orders');
    await engine.stores.workflows.put(wf);
    const { run } = await engine.scheduler.enqueue(wf);
    await engine.idle();

    // Editing the environment must not rewrite history.
    await engine.stores.variables.put({
      environmentId: dev.id,
      scope: 'global',
      key: 'api_base',
      value: 'changed',
    });
    expect((await engine.stores.runs.get(run!.id))?.variables).toEqual({
      api_base: 'original',
    });
    engine.close();
  });

  it('sub-workflow children inherit the parent run environment', async () => {
    const engine = engineFor();
    await engine.stores.environments.create({ name: 'dev' });
    const prod = await engine.stores.environments.create({ name: 'prod' });
    await engine.stores.variables.put({
      environmentId: prod.id,
      scope: 'global',
      key: 'api_base',
      value: 'https://api.example.com',
    });

    const child = parseWorkflow({
      id: 'child',
      name: 'child',
      triggers: [{ id: 'parent', kind: 'parent', enabled: true }],
      pipelines: [
        {
          id: 'main',
          name: 'main',
          pipes: [
            { id: 'src', role: 'source', type: 'source.triggerPayload', config: {} },
          ],
          edges: [],
        },
      ],
    });
    const caller = parseWorkflow({
      id: 'caller',
      name: 'caller',
      triggers: [
        { id: 'manual', kind: 'manual', enabled: true, inputData: [{ n: 1 }] },
      ],
      pipelines: [
        {
          id: 'main',
          name: 'main',
          pipes: [
            { id: 'src', role: 'source', type: 'source.trigger.manual', config: {} },
            {
              id: 'call',
              role: 'transform',
              type: 'workflow.sub',
              config: { workflowId: 'child' },
            },
          ],
          edges: [{ from: 'src', to: 'call' }],
        },
      ],
    });
    await engine.stores.workflows.put(child);
    await engine.stores.workflows.put(caller);

    // Caller overridden to prod while dev is active — the child must follow
    // the caller, not the active environment.
    await engine.scheduler.enqueue(caller, undefined, { environment: 'prod' });
    await engine.idle();

    const childRun = (await engine.stores.runs.list('child'))[0];
    expect(childRun?.status).toBe('succeeded');
    expect(childRun?.environmentId).toBe(prod.id);
    expect(childRun?.variables).toEqual({
      api_base: 'https://api.example.com',
    });
    engine.close();
  });

  it('runs normally when no environment exists at all', async () => {
    const engine = engineFor();
    const wf = workflow('orders');
    await engine.stores.workflows.put(wf);
    const { run } = await engine.scheduler.enqueue(wf);
    await engine.idle();

    const stored = await engine.stores.runs.get(run!.id);
    expect(stored?.status).toBe('succeeded');
    expect(stored?.environmentId).toBeUndefined();
    expect(stored?.variables).toBeUndefined();
    engine.close();
  });
});
