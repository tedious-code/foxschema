/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/timeout.test.ts).
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

class OneBatchSource implements SourcePipe {
  readonly type = 'test.src';
  readonly role = 'source';
  constructor(private readonly stallMs = 0) {}
  async *read(context: PipeContext): AsyncIterable<RecordBatch> {
    if (this.stallMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.stallMs));
    }
    yield {
      id: `${context.pipe.id}:0:1-1`,
      partitionId: '0',
      records: [{ n: 1 }],
      cursor: { row: 1 },
    };
  }
}

/** Stands in for a request that never comes back. */
class HangingSink implements SinkPipe {
  readonly type = 'test.sink';
  readonly role = 'sink';
  attempts = 0;
  async write(): Promise<void> {
    this.attempts += 1;
    await new Promise(() => {});
  }
}

function build(source: SourcePipe, sink: SinkPipe, pipeline: PipelineDef) {
  const executor = new PipelineExecutor({
    registry: new PipeRegistry([source, sink]),
  });
  return () => executor.execute(pipeline, { workflowRunId: 'r1' });
}

function def(sinkExtra: Record<string, unknown>, srcExtra = {}): PipelineDef {
  return {
    id: 'p',
    pipes: [
      { id: 'src', type: 'test.src', role: 'source', config: {}, concurrency: 1, ...srcExtra },
      { id: 'out', type: 'test.sink', role: 'sink', config: {}, concurrency: 1, ...sinkExtra },
    ],
    edges: [{ from: 'src', to: 'out' }],
  } as PipelineDef;
}

describe('pipe timeouts', () => {
  it('fails a sink that never returns instead of holding the run open', async () => {
    const sink = new HangingSink();
    const run = build(new OneBatchSource(), sink, def({ timeoutMs: 100 }));

    const started = Date.now();
    await expect(run()).rejects.toThrow(/exceeded its 100ms timeout/);
    // Bounded by the budget, not by the sink (which never resolves).
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('bounds the wait for a source batch too', async () => {
    // A hung source is as damaging as a hung sink and used to be unbounded.
    const run = build(
      new OneBatchSource(5_000),
      new HangingSink(),
      def({}, { timeoutMs: 100 }),
    );

    const started = Date.now();
    await expect(run()).rejects.toThrow(/pipe src read exceeded/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('is transient, so an existing retry policy handles it', async () => {
    const sink = new HangingSink();
    const run = build(
      new OneBatchSource(),
      sink,
      def({
        timeoutMs: 50,
        // `transient` is the default `on`, so a timeout must classify as one
        // for this policy to engage at all.
        retry: {
          attempts: 2,
          backoff: 'fixed',
          maxDelayMs: 1,
          jitter: false,
          on: 'transient',
        },
      }),
    );

    await expect(run()).rejects.toThrow(/timeout/);
    // The first attempt plus two retries — proof the timeout was classified
    // transient rather than fatal.
    expect(sink.attempts).toBe(3);
  });

  it('leaves pipes without a timeout unbounded, as before', async () => {
    // Opt-in: adding the field must not start failing long-running migrations.
    const sink = new HangingSink();
    const run = build(new OneBatchSource(), sink, def({}));

    const settled = await Promise.race([
      run().then(() => 'finished').catch(() => 'failed'),
      new Promise((resolve) => setTimeout(() => resolve('still running'), 200)),
    ]);

    expect(settled).toBe('still running');
  });
});
