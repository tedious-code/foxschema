/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/sub-workflow.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LocalRunScheduler,
  PipeRegistry,
  PipelineExecutor,
  SubWorkflowPipe,
  TriggerPayloadSourcePipe,
  WorkflowRunner,
  createWorkflowServiceFactory,
  parseWorkflow,
  type WorkflowDef,
} from '../index.js';
import { openSqliteStores } from './index.js';

function subWorkflowRuntime(stores: ReturnType<typeof openSqliteStores>) {
  const executor = new PipelineExecutor({
    registry: new PipeRegistry([
      new TriggerPayloadSourcePipe(),
      new SubWorkflowPipe(),
    ]),
    checkpoints: stores.checkpoints,
    events: stores.events,
    runs: stores.runs,
  });
  const dispatcher: { scheduler?: LocalRunScheduler } = {};
  const runner = new WorkflowRunner({
    runs: stores.runs,
    events: stores.events,
    pipelineExecutor: executor,
    workflows: createWorkflowServiceFactory({
      dispatcher: {
        enqueue: (workflow, invocation, options) =>
          dispatcher.scheduler!.enqueue(workflow, invocation, options),
      },
      workflows: stores.workflows,
      runs: stores.runs,
      pollIntervalMs: 5,
    }),
  });
  const scheduler = new LocalRunScheduler({
    runs: stores.runs,
    events: stores.events,
    runner,
    instanceId: 'sub-workflow-test',
  });
  dispatcher.scheduler = scheduler;
  return scheduler;
}

function leaf(
  id: string,
  extras: Record<string, unknown> = {},
): WorkflowDef {
  const { triggers, ...rest } = extras;
  return parseWorkflow({
    id,
    name: id,
    triggers: triggers ?? [
      { id: 'manual', kind: 'manual', enabled: true },
      { id: 'parent', kind: 'parent', enabled: true },
    ],
    ...rest,
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

function caller(id: string, target: string): WorkflowDef {
  return parseWorkflow({
    id,
    name: id,
    // Callers may themselves be called in nested/cycle scenarios.
    triggers: [
      { id: 'manual', kind: 'manual', enabled: true },
      { id: 'parent', kind: 'parent', enabled: true },
    ],
    pipelines: [
      {
        id: 'main',
        name: 'main',
        pipes: [
          { id: 'src', role: 'source', type: 'source.triggerPayload', config: {} },
          {
            id: 'sub',
            role: 'transform',
            type: 'workflow.sub',
            config: { workflowId: target },
          },
        ],
        edges: [{ from: 'src', to: 'sub' }],
      },
    ],
  });
}

describe('sub-workflow dispatch', () => {
  it('runs the child with the parent batch as payload and records lineage', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = subWorkflowRuntime(stores);
    const parent = caller('parent', 'child');
    const child = leaf('child');
    await stores.workflows.put(parent);
    await stores.workflows.put(child);

    const { run } = await scheduler.enqueue(parent, {
      id: 'inv-parent',
      workflowId: 'parent',
      triggerId: 'manual',
      kind: 'manual',
      acceptedAt: new Date().toISOString(),
      payload: [{ sku: 'A-1' }],
      metadata: {},
    });
    await scheduler.idle();

    expect(await stores.runs.get(run!.id)).toMatchObject({
      status: 'succeeded',
    });
    const childRuns = await stores.runs.list('child');
    expect(childRuns).toHaveLength(1);
    expect(childRuns[0]).toMatchObject({
      status: 'succeeded',
      parentRunId: run!.id,
      trigger: 'parent',
    });
    // The parent batch records became the child's invocation payload.
    expect(await stores.runs.getInvocation(childRuns[0]!.id)).toMatchObject({
      kind: 'parent',
      payload: [{ sku: 'A-1' }],
    });
    stores.close();
  });

  it('rejects sub-workflow dispatch when the child has no parent trigger', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = subWorkflowRuntime(stores);
    const parent = caller('parent-no-gate', 'child-manual-only');
    const child = leaf('child-manual-only', {
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
    });
    await stores.workflows.put(parent);
    await stores.workflows.put(child);

    const { run } = await scheduler.enqueue(parent, {
      id: 'inv-no-parent',
      workflowId: 'parent-no-gate',
      triggerId: 'manual',
      kind: 'manual',
      acceptedAt: new Date().toISOString(),
      payload: [{ sku: 'A-1' }],
      metadata: {},
    });
    await scheduler.idle();

    expect(await stores.runs.get(run!.id)).toMatchObject({ status: 'failed' });
    expect(await stores.runs.list('child-manual-only')).toHaveLength(0);
    const pipelines = await stores.runs.listPipelines(run!.id);
    expect(pipelines[0]?.error).toMatch(
      /no enabled parent trigger for sub-workflow dispatch/,
    );
    stores.close();
  });

  it('rejects sub-workflow dispatch when allowFrom excludes the caller', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = subWorkflowRuntime(stores);
    const parent = caller('blocked-parent', 'allowlisted-child');
    const child = leaf('allowlisted-child', {
      triggers: [
        { id: 'manual', kind: 'manual', enabled: true },
        {
          id: 'parent',
          kind: 'parent',
          enabled: true,
          allowFrom: ['someone-else'],
        },
      ],
    });
    await stores.workflows.put(parent);
    await stores.workflows.put(child);

    const { run } = await scheduler.enqueue(parent, {
      id: 'inv-blocked',
      workflowId: 'blocked-parent',
      triggerId: 'manual',
      kind: 'manual',
      acceptedAt: new Date().toISOString(),
      payload: [{ sku: 'A-1' }],
      metadata: {},
    });
    await scheduler.idle();

    expect(await stores.runs.get(run!.id)).toMatchObject({ status: 'failed' });
    expect(await stores.runs.list('allowlisted-child')).toHaveLength(0);
    const pipelines = await stores.runs.listPipelines(run!.id);
    expect(pipelines[0]?.error).toMatch(
      /does not allow calls from blocked-parent/,
    );
    stores.close();
  });

  it("enforces the child's inputSchema against the dispatched batch", async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = subWorkflowRuntime(stores);
    const parent = caller('strict-parent', 'strict-child');
    // The child demands at least two records; the parent will send one.
    const child = leaf('strict-child', {
      inputSchema: { type: 'array', minItems: 2 },
    });
    await stores.workflows.put(parent);
    await stores.workflows.put(child);

    const { run } = await scheduler.enqueue(parent, {
      id: 'inv-strict',
      workflowId: 'strict-parent',
      triggerId: 'manual',
      kind: 'manual',
      acceptedAt: new Date().toISOString(),
      payload: [{ sku: 'only-one' }],
      metadata: {},
    });
    await scheduler.idle();

    expect(await stores.runs.get(run!.id)).toMatchObject({ status: 'failed' });
    // The child was never admitted — its contract rejected the dispatch.
    expect(await stores.runs.list('strict-child')).toHaveLength(0);
    const pipelines = await stores.runs.listPipelines(run!.id);
    expect(pipelines[0]?.error).toMatch(/strict-child input invalid/);
    stores.close();
  });

  it('layer 3 guard fails a stored A → B → A cycle with the chain in the error', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = subWorkflowRuntime(stores);
    const loopA = caller('loop-a', 'loop-b');
    const loopB = caller('loop-b', 'loop-a');
    // Stored directly — simulating a cycle that slipped past save-time checks.
    await stores.workflows.put(loopA);
    await stores.workflows.put(loopB);

    const { run } = await scheduler.enqueue(loopA, {
      id: 'inv-loop',
      workflowId: 'loop-a',
      triggerId: 'manual',
      kind: 'manual',
      acceptedAt: new Date().toISOString(),
      payload: [{ n: 1 }],
      metadata: {},
    });
    await scheduler.idle();

    expect(await stores.runs.get(run!.id)).toMatchObject({ status: 'failed' });
    const loopBRun = (await stores.runs.list('loop-b'))[0]!;
    expect(loopBRun.status).toBe('failed');
    const pipelines = await stores.runs.listPipelines(loopBRun.id);
    expect(pipelines[0]?.error).toMatch(
      /Circular Workflow Dependency: loop-a → loop-b → loop-a/,
    );
    stores.close();
  });
});
