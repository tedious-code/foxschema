/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/script.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import { ScriptTransformPipe } from './script.js';

function batch(records: Record<string, unknown>[]): RecordBatch {
  return { id: 'src:0:1-2', partitionId: '0', records };
}

function context(config: Record<string, unknown>): PipeContext {
  return {
    workflowRunId: 'r1',
    pipelineId: 'p1',
    pipe: { id: 'script', type: 'transform.script', role: 'transform', config, concurrency: 1 },
  } as PipeContext;
}

const pipe = new ScriptTransformPipe();

describe('transform.script', () => {
  it('runs a transform map cannot express', async () => {
    // Arithmetic and a conditional — the wall `transform.map` hits.
    const ports = await pipe.transform(
      batch([{ price: 100, qty: 3 }, { price: 50, qty: 1 }]),
      context({
        script: `return records.map((r) => ({
          total: r.price * r.qty,
          tier: r.price * r.qty > 200 ? 'large' : 'small',
        }));`,
      }),
    );

    expect(ports.get('out')?.records).toEqual([
      { total: 300, tier: 'large' },
      { total: 50, tier: 'small' },
    ]);
  });

  it('can drop and add records, not just reshape them', async () => {
    const ports = await pipe.transform(
      batch([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]),
      context({ script: 'return records.filter((r) => r.n % 2 === 0);' }),
    );

    expect(ports.get('out')?.records).toEqual([{ n: 2 }, { n: 4 }]);
  });

  it('fails the batch when a script loops forever, and does not hang', async () => {
    // The reason this pipe runs off-thread at all. In-process this would wedge
    // the event loop and take every other run with it.
    const started = Date.now();

    await expect(
      pipe.transform(
        batch([{ n: 1 }]),
        context({ script: 'while (true) {}', timeoutMs: 300 }),
      ),
    ).rejects.toThrow(/terminated/);

    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('dead-letters the batch instead of failing when told to skip', async () => {
    const ports = await pipe.transform(
      batch([{ n: 1 }, { n: 2 }]),
      context({ script: 'throw new Error("bad script");', onError: 'skip' }),
    );

    expect(ports.has('out')).toBe(false);
    const rejects = ports.get('rejects')!;
    // Records are carried through with the reason — nothing is silently lost.
    expect(rejects.records).toEqual([
      { n: 1, _error: expect.stringContaining('bad script') },
      { n: 2, _error: expect.stringContaining('bad script') },
    ]);
    // Cursor-less, like every dead-letter batch.
    expect(rejects.cursor).toBeUndefined();
  });

  it('rejects a script that does not return an array of records', async () => {
    // A string or a null travelling downstream as if it were a batch is worse
    // than an error naming what came back.
    await expect(
      pipe.transform(batch([{ n: 1 }]), context({ script: 'return "nope";' })),
    ).rejects.toThrow(/must return an array of records, got string/);

    await expect(
      pipe.transform(batch([{ n: 1 }]), context({ script: 'return [1, 2];' })),
    ).rejects.toThrow(/returned number at index 0/);
  });

  it('validates config up front', () => {
    expect(() => pipe.validateConfig({ script: '' })).toThrow();
    expect(() => pipe.validateConfig({ script: 'return records;' })).not.toThrow();
  });

  it('declares a rejects port so the dead-letter can be routed', () => {
    expect(pipe.metadata().outputs.map((o) => o.name)).toEqual(['out', 'rejects']);
  });
});
