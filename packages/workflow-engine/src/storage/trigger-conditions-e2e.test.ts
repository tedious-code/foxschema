/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/trigger-conditions-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Engine, PipeRegistry, parseWorkflowInput } from '../index.js';
import { ScriptTransformPipe } from '../pipes/utility/index.js';
import {
  ManualTriggerSourcePipe,
  TriggerPayloadSourcePipe,
} from '../pipes/trigger/index.js';
import type { PipeContext, RecordBatch, SinkPipe } from '../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../sdk/index.js';

/**
 * Conditions against a real engine and database.
 *
 * The claim is negative and cannot be made anywhere else: when a condition
 * refuses, *no run record exists*. Checking inside the workflow would leave a
 * row per evaluation, which is the thing this replaces.
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

function workflowWith(conditions: unknown[]): Record<string, unknown> {
  return {
    id: 'gated',
    name: 'gated',
    version: 1,
    triggers: [{ id: 'manual', kind: 'manual', enabled: true, conditions }],
    pipelines: [
      {
        id: 'main',
        name: 'Main',
        pipes: [
          { id: 'in', type: 'source.triggerPayload', role: 'source', config: {} },
          { id: 'out', type: 'sink.recording', role: 'sink', config: {} },
        ],
        edges: [{ from: 'in', to: 'out' }],
      },
    ],
  };
}

function engineFor(sink: RecordingSink, sql?: unknown): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'conditions-e2e',
    ...(sql ? { sql: sql as never } : {}),
    registry: new PipeRegistry([
      new ManualTriggerSourcePipe(),
      new TriggerPayloadSourcePipe(),
      new ScriptTransformPipe(),
      sink,
    ]),
  });
}

async function enqueue(engine: Engine, payload: unknown) {
  const stored = await engine.stores.workflows.get('gated');
  if (!stored) throw new Error('missing workflow');
  return engine.scheduler.enqueue(stored as never, {
    id: randomBytes(8).toString('hex'),
    workflowId: 'gated',
    triggerId: 'manual',
    kind: 'manual',
    acceptedAt: new Date().toISOString(),
    payload,
  } as never);
}

describe('a trigger with conditions', () => {
  it('creates no run when a condition refuses', async () => {
    const sink = new RecordingSink();
    const engine = engineFor(sink);
    try {
      await engine.stores.workflows.put(
        parseWorkflowInput(
          workflowWith([
            { check: 'payload', path: 'total', op: 'gte', value: 100 },
          ]) as never,
        ) as never,
      );
      await engine.start();

      const result = await enqueue(engine, { total: 5 });
      await engine.idle();

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('condition');
      expect(result.detail).toBe('payload total gte');
      // The point: nothing was written. A gate inside the workflow would have
      // left a succeeded run here, every time, forever.
      expect(await engine.stores.runs.list()).toEqual([]);
      expect(sink.written).toEqual([]);
    } finally {
      engine.close();
    }
  });

  it('runs normally when the conditions pass', async () => {
    const sink = new RecordingSink();
    const engine = engineFor(sink);
    try {
      await engine.stores.workflows.put(
        parseWorkflowInput(
          workflowWith([
            { check: 'payload', path: 'total', op: 'gte', value: 100 },
          ]) as never,
        ) as never,
      );
      await engine.start();

      const result = await enqueue(engine, { total: 250 });
      await engine.idle();

      expect(result.accepted).toBe(true);
      expect((await engine.stores.runs.list())[0]?.status).toBe('succeeded');
    } finally {
      engine.close();
    }
  });

  it('gives the run what a passing condition fetched', async () => {
    const sink = new RecordingSink();
    const sql = vi.fn().mockResolvedValue([{ id: 7, total: 40 }]);
    const engine = engineFor(sink, sql);
    try {
      await engine.stores.workflows.put(
        parseWorkflowInput(
          workflowWith([
            {
              check: 'sql',
              credentialId: 'db',
              engine: 'postgres',
              query: 'select id, total from orders where status = 1',
              expect: { op: 'gte', value: 1 },
              passAs: 'orders',
            },
          ]) as never,
        ) as never,
      );
      await engine.start();

      await enqueue(engine, { tick: true });
      await engine.idle();

      // Merged into the payload, not replacing it — turning a condition on
      // must not break a pipeline that reads what the trigger sent.
      expect(sink.written[0]).toMatchObject({
        tick: true,
        orders: [{ id: 7, total: 40 }],
      });
    } finally {
      engine.close();
    }
  });
});
