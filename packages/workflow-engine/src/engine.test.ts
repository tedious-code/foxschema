/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/engine/src/engine.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine } from './engine.js';
import { parseWorkflow } from './common/index.js';

function testEngine(): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'engine-test',
    subWorkflowPollIntervalMs: 5,
  });
}

function simpleWorkflow(middleware: unknown[] = []) {
  return parseWorkflow({
    id: 'wf',
    name: 'wf',
    middleware,
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

function invocation(payload: unknown) {
  return {
    id: crypto.randomUUID(),
    workflowId: 'wf',
    triggerId: 'manual',
    kind: 'manual' as const,
    acceptedAt: new Date().toISOString(),
    payload,
    metadata: {},
  };
}

describe('Engine facade with three-tier middleware', () => {
  it('runs middleware at every tier, onion-ordered, with per-reference config', async () => {
    const engine = testEngine();
    const log: string[] = [];
    engine.middleware.register('trace', async (ctx, next) => {
      log.push(`${ctx.tier}:${String(ctx.config.tag ?? '')}:before`);
      await next();
      log.push(`${ctx.tier}:after`);
    });
    engine.middleware.register(
      'auth',
      async (ctx, next) => {
        const payload = ctx.invocation?.payload as { deny?: boolean } | undefined;
        if (payload && !Array.isArray(payload) && payload.deny) {
          throw new Error('auth rejected');
        }
        await next();
      },
      { tiers: ['engine'] },
    );
    const workflow = simpleWorkflow([{ name: 'trace', config: { tag: 't' } }, 'auth']);
    await engine.stores.workflows.put(workflow);

    const result = await engine.scheduler.enqueue(workflow, invocation([{ ok: 1 }]));
    expect(result.accepted).toBe(true);
    await engine.idle();
    expect(await engine.stores.runs.get(result.run!.id)).toMatchObject({
      status: 'succeeded',
    });

    // Engine tier wraps admission; workflow wraps pipeline execution.
    expect(log.indexOf('engine:t:before')).toBeLessThan(log.indexOf('engine:after'));
    const workflowBefore = log.indexOf('workflow:t:before');
    const pipelineBefore = log.indexOf('pipeline:t:before');
    expect(workflowBefore).toBeLessThan(pipelineBefore);
    expect(pipelineBefore).toBeLessThan(log.indexOf('pipeline:after'));
    expect(log.indexOf('pipeline:after')).toBeLessThan(log.indexOf('workflow:after'));

    // Engine-tier rejection happens before a run exists.
    await expect(
      engine.scheduler.enqueue(workflow, invocation({ deny: true })),
    ).rejects.toThrow('auth rejected');
    expect(await engine.stores.runs.list('wf')).toHaveLength(1);
    engine.close();
  });

  it('fails the run when workflow-tier middleware throws — nothing silent', async () => {
    const engine = testEngine();
    engine.middleware.register(
      'boom',
      async () => {
        throw new Error('boom failed');
      },
      { tiers: ['workflow'] },
    );
    const workflow = simpleWorkflow(['boom']);
    await engine.stores.workflows.put(workflow);
    const { run } = await engine.scheduler.enqueue(workflow, invocation([{}]));
    await engine.idle();
    expect(await engine.stores.runs.get(run!.id)).toMatchObject({
      status: 'failed',
      error: 'boom failed',
    });
    engine.close();
  });

  it('treats a silent short-circuit as a failure', async () => {
    const engine = testEngine();
    engine.middleware.register('swallow', async () => {}, {
      tiers: ['pipeline'],
    });
    const workflow = simpleWorkflow(['swallow']);
    await engine.stores.workflows.put(workflow);
    const { run } = await engine.scheduler.enqueue(workflow, invocation([{}]));
    await engine.idle();
    const pipelines = await engine.stores.runs.listPipelines(run!.id);
    expect(pipelines[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('short-circuited without an error: swallow'),
    });
    engine.close();
  });

  it('rejects unregistered middleware references at admission', async () => {
    const engine = testEngine();
    const workflow = simpleWorkflow(['nope']);
    await expect(
      engine.scheduler.enqueue(workflow, invocation([{}])),
    ).rejects.toThrow('middleware not registered: nope');
    engine.close();
  });
});
