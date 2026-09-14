/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/pipelining.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { PipelineExecutor } from './executor.js';
import {
  PipeRegistry,
  type PipeContext,
  type RecordBatch,
  type SinkPipe,
  type SourcePipe,
} from '../registry/index.js';
import type { PipelineDef } from '../common/index.js';

/** Emits `count` single-record batches with a row cursor. */
class CountingSource implements SourcePipe {
  readonly type = 'test.source';
  readonly role = 'source';
  readonly reads: number[] = [];

  constructor(
    private readonly count: number,
    private readonly readDelayMs = 0,
  ) {}

  async *read(context: PipeContext): AsyncIterable<RecordBatch> {
    for (let i = 1; i <= this.count; i++) {
      if (this.readDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.readDelayMs));
      }
      this.reads.push(i);
      yield {
        id: `${context.pipe.id}:0:${i}-${i}`,
        partitionId: '0',
        records: [{ n: i }],
        cursor: { row: i },
      };
    }
  }
}

/** Records overlap so a test can prove batches really travelled together. */
class SlowSink implements SinkPipe {
  readonly type = 'test.sink';
  readonly role = 'sink';
  readonly order: number[] = [];
  peakInFlight = 0;
  private inFlight = 0;

  constructor(
    private readonly delayMs: number,
    private readonly failOn?: number,
  ) {}

  async write(batch: RecordBatch): Promise<void> {
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      const n = batch.records[0]!.n as number;
      if (n === this.failOn) throw new Error(`sink failed on ${n}`);
      this.order.push(n);
    } finally {
      this.inFlight -= 1;
    }
  }
}

function pipeline(concurrency: number): PipelineDef {
  return {
    id: 'p1',
    pipes: [
      { id: 'src', type: 'test.source', role: 'source', config: {}, concurrency },
      { id: 'out', type: 'test.sink', role: 'sink', config: {}, concurrency: 1 },
    ],
    edges: [{ from: 'src', to: 'out' }],
  } as PipelineDef;
}

function build(source: SourcePipe, sink: SinkPipe) {
  const registry = new PipeRegistry([source, sink]);
  const saved: RecordBatch['cursor'][] = [];
  const executor = new PipelineExecutor({
    registry,
    checkpoints: {
      // Only the source checkpoints here; record the cursor order.
      async put(checkpoint: { pipeId: string; cursor: RecordBatch['cursor'] }) {
        if (checkpoint.pipeId === 'src') saved.push(checkpoint.cursor);
      },
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
    } as never,
  });
  return { executor, saved };
}

describe('source pipelining', () => {
  it('overlaps batches up to pipe.concurrency', async () => {
    const source = new CountingSource(8);
    const sink = new SlowSink(20);
    const { executor } = build(source, sink);

    await executor.execute(pipeline(4), { workflowRunId: 'r1' });

    // With a 20ms sink and 8 batches, serial execution can never have more
    // than one write in flight; the window is what makes them overlap.
    expect(sink.peakInFlight).toBe(4);
    expect(sink.order).toHaveLength(8);
  });

  it('honours concurrency declared on the sink, not just the source', async () => {
    // The window belongs to the pipeline, so a knob on any pipe has to count.
    // Reading only the source's number left `concurrency` on a sink inert —
    // someone asking a Postgres sink to write four at once got one.
    const source = new CountingSource(8);
    const sink = new SlowSink(20);
    const definition = pipeline(1);
    definition.pipes[1]!.concurrency = 4;
    const { executor } = build(source, sink);

    await executor.execute(definition, { workflowRunId: 'r1' });

    expect(sink.peakInFlight).toBe(4);
  });

  it('stays strictly serial at the default concurrency of 1', async () => {
    const source = new CountingSource(5);
    const sink = new SlowSink(5);
    const { executor, saved } = build(source, sink);

    await executor.execute(pipeline(1), { workflowRunId: 'r1' });

    expect(sink.peakInFlight).toBe(1);
    expect(sink.order).toEqual([1, 2, 3, 4, 5]);
    expect(saved).toEqual([1, 2, 3, 4, 5].map((row) => ({ row })));
  });

  it('advances the checkpoint in batch order, never past one in flight', async () => {
    // Completion order is controlled explicitly rather than with delays.
    // Racing short timeouts made this flaky under a loaded suite — and a test
    // that only sometimes reproduces out-of-order completion is not testing
    // out-of-order completion.
    const gates = new Map<number, () => void>();
    const arrived: number[] = [];

    class Gated extends SlowSink {
      constructor() {
        super(0);
      }
      override async write(batch: RecordBatch): Promise<void> {
        const n = batch.records[0]!.n as number;
        arrived.push(n);
        await new Promise<void>((resolve) => gates.set(n, resolve));
        this.order.push(n);
      }
    }

    const source = new CountingSource(6);
    const sink = new Gated();
    const { executor, saved } = build(source, sink);

    const run = executor.execute(pipeline(6), { workflowRunId: 'r1' });

    // Wait for all six to be in flight, then release them backwards.
    while (arrived.length < 6) await new Promise((resolve) => setImmediate(resolve));
    for (let n = 6; n >= 1; n--) {
      gates.get(n)!();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await run;

    // Writes completed in exactly the reverse of read order …
    expect(sink.order).toEqual([6, 5, 4, 3, 2, 1]);
    // … and the cursor still climbed 1..6, so a crash-resume is safe.
    expect(saved).toEqual([1, 2, 3, 4, 5, 6].map((row) => ({ row })));
  });

  it('does not checkpoint a batch behind a failed one', async () => {
    const source = new CountingSource(6);
    // Batch 2 fails; 3+ may already be in flight and may even succeed.
    const sink = new SlowSink(5, 2);
    const { executor, saved } = build(source, sink);

    await expect(
      executor.execute(pipeline(4), { workflowRunId: 'r1' }),
    ).rejects.toThrow('sink failed on 2');

    // Only batch 1 is durable: the cursor must not jump over the failure just
    // because a later batch happened to finish.
    expect(saved).toEqual([{ row: 1 }]);
  });

  it('surfaces a failure even when it is not the head of the window', async () => {
    const source = new CountingSource(4);
    const sink = new SlowSink(5, 4);
    const { executor } = build(source, sink);

    await expect(
      executor.execute(pipeline(4), { workflowRunId: 'r1' }),
    ).rejects.toThrow('sink failed on 4');
  });

  it('keeps reading while earlier batches are still being written', async () => {
    // Measured as a *ratio* of serial to overlapped in the same process, not
    // against a millisecond budget: a loaded CI runner slows both down
    // proportionally, so the ratio holds where an absolute bound would flake.
    const time = async (concurrency: number): Promise<number> => {
      const { executor } = build(new CountingSource(6), new SlowSink(30));
      const started = Date.now();
      await executor.execute(pipeline(concurrency), { workflowRunId: 'r1' });
      return Date.now() - started;
    };

    const serial = await time(1);
    const overlapped = await time(6);

    // Serial is ~6 × 30ms of writes; overlapped is ~1 × 30ms. Asserting only
    // 2x leaves generous headroom while still failing outright if the window
    // regresses to serial.
    expect(serial / overlapped).toBeGreaterThan(2);
  });
});
