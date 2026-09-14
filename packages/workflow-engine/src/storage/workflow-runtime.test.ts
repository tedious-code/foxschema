/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/workflow-runtime.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalRunScheduler,
  WorkflowRunner,
  parseWorkflow,
  type PipelineDef,
} from '../index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openSqliteStores } from './index.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

async function stores() {
  const directory = await mkdtemp(join(tmpdir(), 'foxflow-runtime-'));
  cleanup.push(directory);
  return openSqliteStores(join(directory, 'runtime.sqlite'), randomBytes(32));
}

const onePipe = (id: string): PipelineDef => ({
  id,
  name: id,
  pipes: [
    {
      id: `${id}-source`,
      role: 'source',
      type: 'test.source',
      config: {},
      concurrency: 1,
    },
  ],
  edges: [],
});

describe('local workflow runtime', () => {
  it('releases dependencies by outcome and skips an unmet multi-inbound target', async () => {
    const db = await stores();
    const workflow = parseWorkflow({
      id: 'workflow',
      name: 'workflow',
      pipelines: [
        onePipe('ok'),
        onePipe('bad'),
        onePipe('after-ok'),
        onePipe('after-bad'),
        onePipe('blocked'),
      ],
      dependencies: [
        { from: 'ok', to: 'after-ok', on: 'success' },
        { from: 'bad', to: 'after-bad', on: 'failure' },
        { from: 'ok', to: 'blocked', on: 'failure' },
        { from: 'bad', to: 'blocked', on: 'failure' },
      ],
    });
    const run = {
      id: 'run-1',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: 'queued' as const,
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      instanceId: 'local',
    };
    await db.runs.create(run, workflow);
    let rootsActive = 0;
    let rootsMax = 0;
    const executed: string[] = [];
    const runner = new WorkflowRunner({
      runs: db.runs,
      events: db.events,
      pipelineExecutor: {
        async execute(pipeline) {
          executed.push(pipeline.id);
          if (pipeline.id === 'ok' || pipeline.id === 'bad') {
            rootsActive++;
            rootsMax = Math.max(rootsMax, rootsActive);
            await new Promise((resolve) => setTimeout(resolve, 5));
            rootsActive--;
          }
          if (pipeline.id === 'bad') throw new Error('expected failure');
        },
      },
    });

    await runner.run(run.id);

    expect(rootsMax).toBe(2);
    expect(executed).toEqual(
      expect.arrayContaining(['ok', 'bad', 'after-ok', 'after-bad']),
    );
    expect(executed).not.toContain('blocked');
    expect(await db.runs.listPipelines(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pipelineId: 'after-ok', status: 'succeeded' }),
        expect.objectContaining({ pipelineId: 'after-bad', status: 'succeeded' }),
        expect.objectContaining({ pipelineId: 'blocked', status: 'skipped' }),
      ]),
    );
    expect(await db.runs.get(run.id)).toMatchObject({ status: 'failed' });
    db.close();
  });

  it('feeds manual trigger inputData to the pipeline as the invocation payload', async () => {
    const db = await stores();
    const workflow = parseWorkflow({
      id: 'workflow',
      name: 'workflow',
      pipelines: [onePipe('load')],
      triggers: [
        {
          id: 'manual',
          kind: 'manual',
          enabled: true,
          inputData: [{ sku: 'A-1' }, { sku: 'B-2' }],
        },
      ],
    });

    let receivedPayload: unknown;
    const runner = new WorkflowRunner({
      runs: db.runs,
      events: db.events,
      pipelineExecutor: {
        async execute(_pipeline, context) {
          receivedPayload = context.invocation?.payload;
        },
      },
    });
    const scheduler = new LocalRunScheduler({
      runs: db.runs,
      events: db.events,
      runner,
      instanceId: 'test',
    });

    // No invocation supplied — the scheduler builds the manual one itself.
    const { run } = await scheduler.enqueue(workflow);
    await scheduler.idle();

    expect(receivedPayload).toEqual([{ sku: 'A-1' }, { sku: 'B-2' }]);
    expect(await db.runs.getInvocation(run!.id)).toMatchObject({
      kind: 'manual',
      payload: [{ sku: 'A-1' }, { sku: 'B-2' }],
    });
    db.close();
  });

  it('enforces skip overlap and resumes abandoned running snapshots', async () => {
    const db = await stores();
    const workflow = parseWorkflow({
      id: 'workflow',
      name: 'workflow',
      pipelines: [onePipe('load')],
      onOverlap: 'skip',
      origin: 'authored',
    });
    const invocation = {
      id: 'manual-invocation',
      workflowId: workflow.id,
      triggerId: 'manual',
      kind: 'manual' as const,
      acceptedAt: '2026-07-13T00:00:00.000Z',
      payload: { requestedBy: 'test' },
      metadata: {},
    };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let executions = 0;
    let receivedPayload: unknown;
    const runner = new WorkflowRunner({
      runs: db.runs,
      events: db.events,
      pipelineExecutor: {
        async execute(_pipeline, context) {
          executions++;
          receivedPayload = context.invocation?.payload;
          if (executions === 1) await blocked;
        },
      },
    });
    const scheduler = new LocalRunScheduler({
      runs: db.runs,
      events: db.events,
      runner,
      instanceId: 'test',
    });

    const [first, overlapping] = await Promise.all([
      scheduler.enqueue(workflow, invocation),
      scheduler.enqueue(workflow, {
        ...invocation,
        id: 'overlap-invocation',
      }),
    ]);
    expect(first.accepted).toBe(true);
    expect(overlapping.accepted).toBe(false);
    release();
    await scheduler.idle();
    expect(receivedPayload).toEqual({ requestedBy: 'test' });
    expect(await db.runs.getInvocation(first.run!.id)).toEqual(invocation);

    const abandoned = {
      id: 'abandoned',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: 'running' as const,
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      instanceId: 'dead-instance',
    };
    await db.runs.create(abandoned, workflow);
    await db.runs.create(
      {
        ...abandoned,
        id: 'queued-after-crash',
        status: 'queued',
      },
      workflow,
    );
    await scheduler.recover();

    expect(await db.runs.get('abandoned')).toMatchObject({ status: 'succeeded' });
    expect(await db.runs.get('queued-after-crash')).toMatchObject({
      status: 'succeeded',
    });
    expect(executions).toBe(3);
    db.close();
  });
});
