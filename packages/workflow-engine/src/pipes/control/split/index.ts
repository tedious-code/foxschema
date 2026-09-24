/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/split/index.ts).
 */
import type {
  PipeContext,
  RecordBatch,
  TransformPipe,
} from '../../../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../../../sdk/index.js';
import { getPath } from '../../../common/index.js';

export type SplitSelector = (
  record: Record<string, unknown>,
) => string | undefined;

/** Partitions one batch into named output ports. */
export function splitBatch(
  batch: RecordBatch,
  select: SplitSelector,
): Map<string, RecordBatch> {
  const recordsByPort = new Map<string, Record<string, unknown>[]>();
  for (const record of batch.records) {
    const port = select(record);
    if (!port) continue;
    const records = recordsByPort.get(port) ?? [];
    records.push(record);
    recordsByPort.set(port, records);
  }
  return new Map(
    [...recordsByPort].map(([port, records]) => [
      port,
      {
        ...batch,
        id: `${batch.id}:${port}`,
        records,
      },
    ]),
  );
}

/** Stable partition key for a field value; never undefined (no silent drops). */
function partitionKey(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Splits each inbound batch into one batch per distinct value of `field`,
 * with `partitionId` set to that value — downstream pipes then process and
 * checkpoint per partition (e.g. per customer, per region). All batches stay
 * on the single `out` port: value-based *routing* to different pipes is
 * ConditionPipe's job (the other face of `splitBatch`), because edge ports
 * must be declared in static metadata.
 */
export class SplitPipe implements TransformPipe {
  readonly type = 'transform.split';
  readonly role = 'transform';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Split',
      category: 'Transform',
      family: 'logic',
      version: '0.1.0',
      role: 'transform',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: {
        type: 'object',
        required: ['field'],
        properties: {
          field: {
            type: 'string',
            minLength: 1,
            description:
              'Record field (dot path) whose value becomes the partition id; missing values group under "null".',
          },
        },
        additionalProperties: false,
      },
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    if (typeof config.field !== 'string' || config.field.length === 0) {
      throw new Error('transform.split requires a field');
    }
  }

  async transform(
    batch: RecordBatch,
    context: PipeContext,
  ): Promise<RecordBatch[]> {
    const field = context.pipe.config.field as string;
    const groups = splitBatch(batch, (record) =>
      partitionKey(getPath(record, field)),
    );
    return [...groups.entries()].map(([key, group]) => ({
      ...group,
      partitionId: key,
    }));
  }
}

