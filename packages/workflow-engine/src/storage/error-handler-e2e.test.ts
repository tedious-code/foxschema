/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/error-handler-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine, PipeRegistry, parseWorkflowInput } from '../index.js';
import { ScriptTransformPipe } from '../pipes/utility/index.js';
import {
  ManualTriggerSourcePipe,
  ParentTriggerSourcePipe,
  TriggerPayloadSourcePipe,
} from '../pipes/trigger/index.js';
import type { PipeContext, RecordBatch, SinkPipe } from '../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../sdk/index.js';

/**
 * "When this workflow fails, run that one."
 *
 * Failure handling was per-pipe (`onError`, `rejects`) or after the fact, by a
 * human reading the run list. This is the whole-run answer — page someone,
 * file a ticket, roll something back — and the case worth proving is not that
 * it fires, but that it cannot fire *forever*.
 */

class RecordingSink implements SinkPipe {
  readonly type = 'sink.recording';
  readonly role = 'sink' as const;
  readonly written: Record<string, unknown>[] = [];

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Recording sink',
      category: 'Sink/Test',
      version: '0.1.0',
      role: 'sink',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [],
      configSchema: { type: 'object', properties: {} },
    });
  }

  async write(batch: RecordBatch, _context: PipeContext): Promise<void> {
    this.written.push(...batch.records);
  }
}

function workflow(
  id: string,
  script: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id,
    version: 1,
    triggers: [
      { id: 'manual', kind: 'manual', enabled: true },
      { id: 'parent', kind: 'parent', enabled: true },
    ],
    pipelines: [
      {
        id: 'main',
        name: 'Main',
        pipes: [
          { id: 'in', type: 'source.triggerPayload', role: 'source', config: {} },
          { id: 'work', type: 'transform.script', role: 'transform', config: { script } },
          { id: 'out', type: 'sink.recording', role: 'sink', config: {} },
        ],
        edges: [
          { from: 'in', to: 'work' },
          { from: 'work', to: 'out' },
        ],
      },
    ],
    ...extra,
  };
}

const BOOM = "throw new Error('the thing broke');";
const FINE = 'return records;';

function buildEngine(sink: RecordingSink): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'error-handler-e2e',
    registry: new PipeRegistry([
      new ManualTriggerSourcePipe(),
      new ParentTriggerSourcePipe(),
      new TriggerPayloadSourcePipe(),
      new ScriptTransformPipe(),
      sink,
    ]),
  });
}

async function run(engine: Engine, id: string): Promise<void> {
  const stored = await engine.stores.workflows.get(id);
  if (!stored) throw new Error(`missing ${id}`);
  await engine.scheduler.enqueue(stored as never, {
    id: randomBytes(8).toString('hex'),
    workflowId: id,
    triggerId: 'manual',
    kind: 'manual',
    acceptedAt: new Date().toISOString(),
  } as never);
  await engine.idle();
}

describe('a workflow that names an error handler', () => {
  it('runs the handler, with what failed', async () => {
    const sink = new RecordingSink();
    const engine = buildEngine(sink);
    try {
      await engine.stores.workflows.put(
        parseWorkflowInput(workflow('handler', FINE) as never) as never,
      );
      await engine.stores.workflows.put(
        parseWorkflowInput(
          workflow('breaks', BOOM, { errorHandler: { workflowId: 'handler' } }) as never,
        ) as never,
      );
      await engine.start();
      await run(engine, 'breaks');
      await engine.idle();

      const runs = await engine.stores.runs.list();
      expect(runs.find((r) => r.workflowId === 'breaks')?.status).toBe('failed');
      // The handler ran, and knows which run failed and why.
      expect(runs.find((r) => r.workflowId === 'handler')?.status).toBe('succeeded');
      expect(sink.written[0]).toMatchObject({
        workflowId: 'breaks',
        failedPipelineId: 'main',
        error: expect.stringContaining('the thing broke'),
      });
    } finally {
      engine.close();
    }
  });

  it('does not summon a handler for the handler', async () => {
    const sink = new RecordingSink();
    const engine = buildEngine(sink);
    try {
      // A handler that itself fails, and points at itself. Without the marker
      // on a handler-dispatched run this is an unbounded chain of runs from
      // one broken workflow.
      await engine.stores.workflows.put(
        parseWorkflowInput(
          workflow('selfish', BOOM, { errorHandler: { workflowId: 'selfish' } }) as never,
        ) as never,
      );
      await engine.start();
      await run(engine, 'selfish');
      await engine.idle();

      const runs = await engine.stores.runs.list();
      // The original, plus exactly one handler run that stops there.
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.status === 'failed')).toBe(true);
    } finally {
      engine.close();
    }
  });

  it('leaves a successful run alone', async () => {
    const sink = new RecordingSink();
    const engine = buildEngine(sink);
    try {
      await engine.stores.workflows.put(
        parseWorkflowInput(workflow('handler', FINE) as never) as never,
      );
      await engine.stores.workflows.put(
        parseWorkflowInput(
          workflow('works', FINE, { errorHandler: { workflowId: 'handler' } }) as never,
        ) as never,
      );
      await engine.start();
      await run(engine, 'works');
      await engine.idle();

      const runs = await engine.stores.runs.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]!.workflowId).toBe('works');
    } finally {
      engine.close();
    }
  });

  it('does not turn a missing handler into a second failure', async () => {
    const sink = new RecordingSink();
    const engine = buildEngine(sink);
    try {
      await engine.stores.workflows.put(
        parseWorkflowInput(
          workflow('orphan', BOOM, { errorHandler: { workflowId: 'gone' } }) as never,
        ) as never,
      );
      await engine.start();
      await run(engine, 'orphan');
      await engine.idle();

      // The run failed for its own reason. A broken handler must not overwrite
      // that with a misleading one — the original error is the useful one.
      const failed = (await engine.stores.runs.list())[0]!;
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('the thing broke');
    } finally {
      engine.close();
    }
  });
});
