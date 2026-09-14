/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/merge/index.ts).
 */
import type {
  PipeContext,
  RecordBatch,
  TransformPipe,
} from '../../../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../../../sdk/index.js';

export interface MergeOptions {
  id?: string;
  partitionId?: string;
}

/** Combines completed branch batches without changing record order. */
export function mergeBatches(
  batches: readonly RecordBatch[],
  options: MergeOptions = {},
): RecordBatch {
  if (batches.length === 0) {
    throw new Error('merge requires at least one batch');
  }
  return {
    id: options.id ?? batches.map((batch) => batch.id).join('+'),
    partitionId: options.partitionId ?? batches[0]!.partitionId,
    records: batches.flatMap((batch) => batch.records),
    cursor: {
      batches: batches.map((batch) => ({
        id: batch.id,
        cursor: batch.cursor,
      })),
    },
  };
}

/**
 * Fan-in junction: joins several upstream branches (e.g. Condition's
 * true/false paths) back into one stream by re-emitting every inbound batch
 * on `out`, unchanged. A buffered merge (combine all branch batches into one
 * via `mergeBatches`) needs an end-of-stream flush hook the executor does not
 * expose to transforms yet — `mergeBatches` stays the primitive for that.
 */
export class MergePipe implements TransformPipe {
  readonly type = 'transform.merge';
  readonly role = 'transform';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Merge',
      category: 'Transform',
      version: '0.1.0',
      role: 'transform',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      simple: true,
    });
  }

  async transform(
    batch: RecordBatch,
    _context: PipeContext,
  ): Promise<RecordBatch> {
    return batch;
  }
}
