/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/loop/index.ts).
 */
import type {
  PipeContext,
  RecordBatch,
  TransformPipe,
} from '../../../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../../../sdk/index.js';

export interface LoopContext {
  iteration: number;
}

export interface LoopResult<T> {
  value: T;
  iterations: number;
}

/** Bounded data loop; graph cycles remain invalid in the compiler. */
export async function runLoop<T>(
  initial: T,
  iterate: (value: T, context: LoopContext) => Promise<T>,
  shouldContinue: (value: T, context: LoopContext) => boolean,
  maxIterations = 100,
): Promise<LoopResult<T>> {
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error('maxIterations must be a positive integer');
  }
  let value = initial;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const context = { iteration };
    if (!shouldContinue(value, context)) {
      return { value, iterations: iteration };
    }
    value = await iterate(value, context);
  }
  throw new Error(`loop exceeded ${maxIterations} iterations`);
}

const DEFAULT_SIZE = 1;
const DEFAULT_MAX_ITERATIONS = 10_000;

function loopConfig(config: Record<string, unknown>): {
  size: number;
  maxIterations: number;
} {
  const size = config.size ?? DEFAULT_SIZE;
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(size) || (size as number) < 1) {
    throw new Error('logic.loop: size must be a positive integer');
  }
  if (!Number.isInteger(maxIterations) || (maxIterations as number) < 1) {
    throw new Error('logic.loop: maxIterations must be a positive integer');
  }
  return { size: size as number, maxIterations: maxIterations as number };
}

/**
 * Batch/chunk iteration (the documented `logic.loop` semantic): re-chunks each
 * inbound batch into batches of `size` records so downstream pipes process
 * them chunk-by-chunk — `size: 1` is "for each record". Driven by `runLoop`,
 * so a chunk count past `maxIterations` fails the pipe instead of spinning.
 * The DAG stays acyclic — this is data iteration, not a graph cycle.
 */
export class LoopPipe implements TransformPipe {
  readonly type = 'logic.loop';
  readonly role = 'transform';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Loop',
      category: 'Logic',
      version: '0.1.0',
      role: 'transform',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: {
        type: 'object',
        properties: {
          size: {
            type: 'integer',
            minimum: 1,
            default: DEFAULT_SIZE,
            description: 'Records per chunk; 1 = iterate record by record.',
          },
          maxIterations: {
            type: 'integer',
            minimum: 1,
            default: DEFAULT_MAX_ITERATIONS,
            description: 'Fail instead of emitting more chunks than this.',
          },
        },
        additionalProperties: false,
      },
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    loopConfig(config);
  }

  async transform(
    batch: RecordBatch,
    context: PipeContext,
  ): Promise<RecordBatch[]> {
    const { size, maxIterations } = loopConfig(context.pipe.config);
    const chunks: RecordBatch[] = [];
    await runLoop(
      0,
      async (offset, { iteration }) => {
        chunks.push({
          id: `${batch.id}:chunk${iteration}`,
          partitionId: batch.partitionId,
          records: batch.records.slice(offset, offset + size),
          cursor: { sourceBatch: batch.id, chunk: iteration },
        });
        return offset + size;
      },
      (offset) => offset < batch.records.length,
      maxIterations,
    );
    return chunks;
  }
}
