/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/control-pipes.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import { LoopPipe } from './loop/index.js';
import { MergePipe } from './merge/index.js';
import { SplitPipe } from './split/index.js';
import { mergeBatches, splitBatch } from './index.js';

function batch(records: Record<string, unknown>[], id = 'b1'): RecordBatch {
  return { id, partitionId: '0', records };
}

function context(config: Record<string, unknown>): PipeContext {
  return {
    pipe: { id: 'p1', role: 'transform', type: 'test', config, concurrency: 1 },
  } as unknown as PipeContext;
}

describe('MergePipe', () => {
  it('re-emits inbound batches unchanged (fan-in junction)', async () => {
    const pipe = new MergePipe();
    const input = batch([{ a: 1 }, { a: 2 }]);
    expect(await pipe.transform(input, context({}))).toBe(input);
    expect(pipe.metadata().category).toBe('Transform');
    expect(pipe.metadata().simple).toBe(true);
  });
});

describe('SplitPipe', () => {
  it('partitions records by field value with partitionId set per group', async () => {
    const pipe = new SplitPipe();
    const out = await pipe.transform(
      batch([
        { region: 'us', n: 1 },
        { region: 'eu', n: 2 },
        { region: 'us', n: 3 },
      ]),
      context({ field: 'region' }),
    );
    expect(out.map((b) => [b.partitionId, b.id, b.records.length])).toEqual([
      ['us', 'b1:us', 2],
      ['eu', 'b1:eu', 1],
    ]);
    expect(out[0]!.records).toEqual([
      { region: 'us', n: 1 },
      { region: 'us', n: 3 },
    ]);
  });

  it('groups missing/null values under "null" instead of dropping them', async () => {
    const pipe = new SplitPipe();
    const out = await pipe.transform(
      batch([{ region: 'us' }, { other: true }, { region: null }]),
      context({ field: 'region' }),
    );
    const nullGroup = out.find((b) => b.partitionId === 'null');
    expect(nullGroup?.records).toHaveLength(2);
    // Every input record survives the split.
    expect(out.reduce((n, b) => n + b.records.length, 0)).toBe(3);
  });

  it('supports dot paths and object values without key collisions', async () => {
    const pipe = new SplitPipe();
    const out = await pipe.transform(
      batch([
        { customer: { tier: 'gold' } },
        { customer: { tier: 'gold' } },
        { customer: { tier: 'basic' } },
      ]),
      context({ field: 'customer.tier' }),
    );
    expect(out.map((b) => b.partitionId).sort()).toEqual(['basic', 'gold']);
  });

  it('rejects a missing field in validateConfig', () => {
    expect(() => new SplitPipe().validateConfig({})).toThrow(/requires a field/);
  });
});

describe('LoopPipe', () => {
  it('chunks a batch record-by-record with size 1 (default)', async () => {
    const pipe = new LoopPipe();
    const out = await pipe.transform(
      batch([{ n: 1 }, { n: 2 }, { n: 3 }]),
      context({}),
    );
    expect(out.map((b) => [b.id, b.records])).toEqual([
      ['b1:chunk0', [{ n: 1 }]],
      ['b1:chunk1', [{ n: 2 }]],
      ['b1:chunk2', [{ n: 3 }]],
    ]);
    expect(out[0]!.cursor).toEqual({ sourceBatch: 'b1', chunk: 0 });
    expect(pipe.metadata().category).toBe('Logic');
  });

  it('chunks by the configured size with a short final chunk', async () => {
    const pipe = new LoopPipe();
    const out = await pipe.transform(
      batch([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]),
      context({ size: 2 }),
    );
    expect(out.map((b) => b.records.length)).toEqual([2, 2, 1]);
  });

  it('emits nothing for an empty batch and fails past maxIterations', async () => {
    const pipe = new LoopPipe();
    expect(await pipe.transform(batch([]), context({}))).toEqual([]);
    await expect(
      pipe.transform(
        batch([{ n: 1 }, { n: 2 }, { n: 3 }]),
        context({ size: 1, maxIterations: 2 }),
      ),
    ).rejects.toThrow(/loop exceeded 2 iterations/);
  });

  it('rejects non-positive size in validateConfig', () => {
    expect(() => new LoopPipe().validateConfig({ size: 0 })).toThrow(
      /positive integer/,
    );
  });
});

describe('batch helpers', () => {
  it('merges batches and splits them by a record key', () => {
    const merged = mergeBatches([
      { id: 'a', partitionId: 'p', records: [{ route: 'left' }] },
      { id: 'b', partitionId: 'p', records: [{ route: 'right' }] },
    ]);
    const split = splitBatch(merged, (record) => String(record.route));
    expect(split.get('left')?.records).toHaveLength(1);
    expect(split.get('right')?.records).toHaveLength(1);
  });
});
