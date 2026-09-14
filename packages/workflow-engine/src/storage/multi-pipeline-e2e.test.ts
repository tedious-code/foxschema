/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/multi-pipeline-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, parseWorkflow, type WorkflowDef } from '../index.js';

/**
 * Multi-pipeline orchestration through the real Engine: completion edges
 * (`dependencies` / `dependsOn` sugar) release pipelines in waves, `on`
 * chooses which terminal state releases a dependent, and `gate` can skip one
 * at the barrier. Covers the paths a real import workflow relies on —
 * fan-out, fan-in, compensation branches, and failure isolation.
 */

function engineFor(): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'multi-pipeline-e2e',
  });
}

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

async function tempFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'foxflow-multi-'));
  cleanup.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

/** A pipeline that always succeeds, emitting the trigger payload. */
function okPipeline(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    pipes: [
      { id: `${id}-src`, role: 'source', type: 'source.triggerPayload', config: {} },
    ],
    edges: [],
    ...extra,
  };
}

/** A pipeline that always fails: its CSV source points at a missing file. */
function failingPipeline(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    pipes: [
      {
        id: `${id}-src`,
        role: 'source',
        type: 'source.file.csv',
        config: { path: '/nonexistent/foxflow-multi-pipeline.csv' },
      },
    ],
    edges: [],
    ...extra,
  };
}

async function runWorkflow(
  engine: Engine,
  workflow: WorkflowDef,
  payload?: unknown,
): Promise<{
  status: string;
  pipelines: Record<string, string>;
  order: string[];
}> {
  await engine.stores.workflows.put(workflow);
  const invocation =
    payload === undefined
      ? undefined
      : {
          id: `inv-${workflow.id}`,
          workflowId: workflow.id,
          triggerId: 'manual',
          kind: 'manual' as const,
          acceptedAt: '2026-07-20T00:00:00.000Z',
          payload,
          metadata: {},
        };
  const { run } = await engine.scheduler.enqueue(workflow, invocation);
  await engine.idle();

  const stored = await engine.stores.runs.get(run!.id);
  const records = await engine.stores.runs.listPipelines(run!.id);
  // Start order comes from the event log's monotonic `seq`, not `startedAt` —
  // pipelines in one wave start inside the same millisecond, so timestamps
  // cannot order them.
  const events = await engine.stores.events.list(run!.id);
  const order = events
    .filter(
      (event) =>
        event.type === 'pipeline.status' &&
        event.data?.status === 'running' &&
        event.pipelineId,
    )
    .sort((a, b) => a.seq - b.seq)
    .map((event) => event.pipelineId!);

  return {
    status: stored?.status ?? 'missing',
    pipelines: Object.fromEntries(
      records.map((record) => [record.pipelineId, record.status]),
    ),
    order,
  };
}

describe('multi-pipeline orchestration', () => {
  it('runs independent pipelines together, then releases their dependents', async () => {
    const engine = engineFor();
    // extract-a ─┐
    //            ├─> transform ─> load
    // extract-b ─┘
    const workflow = parseWorkflow({
      id: 'fan-in',
      name: 'fan-in',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        okPipeline('extract-a'),
        okPipeline('extract-b'),
        okPipeline('transform', { dependsOn: ['extract-a', 'extract-b'] }),
        okPipeline('load', { dependsOn: ['transform'] }),
      ],
    });
    const result = await runWorkflow(engine, workflow);

    expect(result.status).toBe('succeeded');
    expect(result.pipelines).toEqual({
      'extract-a': 'succeeded',
      'extract-b': 'succeeded',
      transform: 'succeeded',
      load: 'succeeded',
    });
    // Both extracts precede transform, which precedes load.
    expect(result.order.slice(0, 2).sort()).toEqual(['extract-a', 'extract-b']);
    expect(result.order.slice(2)).toEqual(['transform', 'load']);
    engine.close();
  });

  it('skips a success-dependent when its upstream fails, without failing siblings', async () => {
    const engine = engineFor();
    const workflow = parseWorkflow({
      id: 'failure-isolation',
      name: 'failure-isolation',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        failingPipeline('extract'),
        // Released only on success — must end up skipped, never failed.
        okPipeline('load', { dependsOn: ['extract'] }),
        // Unrelated pipeline still runs.
        okPipeline('audit'),
      ],
    });
    const result = await runWorkflow(engine, workflow);

    expect(result.pipelines).toEqual({
      extract: 'failed',
      load: 'skipped',
      audit: 'succeeded',
    });
    // A failed pipeline fails the run even though others succeeded.
    expect(result.status).toBe('failed');
    engine.close();
  });

  it('runs a compensation pipeline only on failure, and `always` either way', async () => {
    const engine = engineFor();
    const workflow = parseWorkflow({
      id: 'compensation',
      name: 'compensation',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        failingPipeline('import'),
        okPipeline('rollback', {
          dependsOn: [{ pipeline: 'import', on: 'failure' }],
        }),
        okPipeline('notify', {
          dependsOn: [{ pipeline: 'import', on: 'always' }],
        }),
        okPipeline('publish', { dependsOn: ['import'] }),
      ],
    });
    const failed = await runWorkflow(engine, workflow);
    expect(failed.pipelines).toEqual({
      import: 'failed',
      rollback: 'succeeded',
      notify: 'succeeded',
      publish: 'skipped',
    });

    // Same shape, but the upstream now succeeds: the mirror image.
    const healthy = parseWorkflow({
      id: 'compensation-ok',
      name: 'compensation-ok',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        okPipeline('import'),
        okPipeline('rollback', {
          dependsOn: [{ pipeline: 'import', on: 'failure' }],
        }),
        okPipeline('notify', {
          dependsOn: [{ pipeline: 'import', on: 'always' }],
        }),
        okPipeline('publish', { dependsOn: ['import'] }),
      ],
    });
    const ok = await runWorkflow(engine, healthy);
    expect(ok.pipelines).toEqual({
      import: 'succeeded',
      rollback: 'skipped',
      notify: 'succeeded',
      publish: 'succeeded',
    });
    expect(ok.status).toBe('succeeded');
    engine.close();
  });

  it('gates a dependent on the trigger payload, evaluated once at the barrier', async () => {
    const engine = engineFor();
    const workflow = parseWorkflow({
      id: 'gated',
      name: 'gated',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        okPipeline('extract'),
        okPipeline('full-reload', {
          dependsOn: [{ pipeline: 'extract', gate: 'payload.mode == "full"' }],
        }),
        okPipeline('incremental', {
          dependsOn: [
            { pipeline: 'extract', gate: 'payload.mode != "full"' },
          ],
        }),
      ],
    });

    const full = await runWorkflow(engine, workflow, { mode: 'full' });
    expect(full.pipelines).toEqual({
      extract: 'succeeded',
      'full-reload': 'succeeded',
      incremental: 'skipped',
    });
    expect(full.status).toBe('succeeded');

    const incremental = await runWorkflow(engine, workflow, { mode: 'delta' });
    expect(incremental.pipelines).toEqual({
      extract: 'succeeded',
      'full-reload': 'skipped',
      incremental: 'succeeded',
    });
    engine.close();
  });

  it('fails only the gated pipeline when its gate expression is unsupported', async () => {
    const engine = engineFor();
    const workflow = parseWorkflow({
      id: 'bad-gate',
      name: 'bad-gate',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        okPipeline('extract'),
        okPipeline('load', {
          dependsOn: [{ pipeline: 'extract', gate: 'definitely not an expression' }],
        }),
        okPipeline('audit'),
      ],
    });
    const result = await runWorkflow(engine, workflow);

    // The bad gate is a config error surfaced on that pipeline alone.
    expect(result.pipelines).toEqual({
      extract: 'succeeded',
      load: 'failed',
      audit: 'succeeded',
    });
    engine.close();
  });

  it('waits for every inbound dependency in a diamond before the join runs', async () => {
    const engine = engineFor();
    //        ┌─> left ─┐
    // root ──┤         ├─> join
    //        └─> right ┘
    const workflow = parseWorkflow({
      id: 'diamond',
      name: 'diamond',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        okPipeline('root'),
        okPipeline('left', { dependsOn: ['root'] }),
        okPipeline('right', { dependsOn: ['root'] }),
        okPipeline('join', { dependsOn: ['left', 'right'] }),
      ],
    });
    const result = await runWorkflow(engine, workflow);

    expect(result.status).toBe('succeeded');
    expect(result.order[0]).toBe('root');
    expect(result.order.slice(1, 3).sort()).toEqual(['left', 'right']);
    expect(result.order[3]).toBe('join');
    engine.close();
  });

  it('cascades skips down a dependency chain', async () => {
    const engine = engineFor();
    const workflow = parseWorkflow({
      id: 'cascade',
      name: 'cascade',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        failingPipeline('extract'),
        okPipeline('transform', { dependsOn: ['extract'] }),
        // Depends on a pipeline that is itself skipped — must also skip,
        // never hang waiting for a success that can't come.
        okPipeline('load', { dependsOn: ['transform'] }),
      ],
    });
    const result = await runWorkflow(engine, workflow);

    expect(result.pipelines).toEqual({
      extract: 'failed',
      transform: 'skipped',
      load: 'skipped',
    });
    engine.close();
  });

  it('carries real data through a dependent multi-pipeline import', async () => {
    const engine = engineFor();
    const usersPath = await tempFile(
      'users.csv',
      'id,email\n1,ada@example.com\nbad,nope\n3,linus@example.com\n',
    );
    const eventsPath = await tempFile(
      'events.ndjson',
      '{"id":1,"kind":"signup"}\n{"id":3,"kind":"login"}\n',
    );

    const workflow = parseWorkflow({
      id: 'import-chain',
      name: 'import-chain',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        {
          id: 'users',
          name: 'users',
          pipes: [
            {
              id: 'csv',
              role: 'source',
              type: 'source.file.csv',
              config: {
                path: usersPath,
                onInvalid: 'reject',
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', pattern: '^\\d+$' },
                    email: { type: 'string', pattern: '^\\S+@\\S+$' },
                  },
                },
              },
            },
            { id: 'clean', role: 'transform', type: 'transform.merge', config: {} },
            { id: 'bad', role: 'transform', type: 'transform.merge', config: {} },
          ],
          edges: [
            { from: 'csv', to: 'clean' },
            { from: 'csv', to: 'bad', fromPort: 'rejects' },
          ],
        },
        {
          id: 'events',
          name: 'events',
          pipes: [
            {
              id: 'json',
              role: 'source',
              type: 'source.file.json',
              config: { path: eventsPath },
            },
          ],
          edges: [],
          dependsOn: ['users'],
        },
      ],
    });
    await engine.stores.workflows.put(workflow);
    const { run } = await engine.scheduler.enqueue(workflow);
    await engine.idle();

    const stored = await engine.stores.runs.get(run!.id);
    expect(stored?.status).toBe('succeeded');
    const stats = Object.fromEntries(
      (await engine.stores.runs.listPipes(run!.id)).map((pipe) => [
        pipe.pipeId,
        pipe.processedRecords,
      ]),
    );
    // 2 valid users out the default port, 1 dead-lettered, 2 events after.
    expect(stats).toMatchObject({ clean: 2, bad: 1, json: 2 });
    engine.close();
  });
});
