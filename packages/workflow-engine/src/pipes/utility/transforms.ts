/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/transforms.ts).
 */
import * as z from 'zod';
import type {
  PipeContext,
  RecordBatch,
  TransformPipe,
} from '../../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../../sdk/index.js';
import { splitBatch } from '../control/index.js';
import { getPath } from '../../common/index.js';

const mapConfigSchema = z.object({
  mappings: z
    .record(z.string(), z.string().min(1))
    .refine((mappings) => Object.keys(mappings).length > 0, 'mappings required'),
  includeOriginal: z.boolean().default(true),
});

export class MapPipe implements TransformPipe {
  readonly type = 'transform.map';
  readonly role = 'transform';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Map fields',
      category: 'Transform',
      version: '0.1.0',
      role: 'transform',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: mapConfigSchema,
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    mapConfigSchema.parse(config);
  }

  async transform(
    batch: RecordBatch,
    context: PipeContext,
  ): Promise<RecordBatch> {
    const config = mapConfigSchema.parse(context.pipe.config);
    return {
      ...batch,
      records: batch.records.map((record) => {
        const mapped = Object.fromEntries(
          Object.entries(config.mappings).map(([target, source]) => [
            target,
            getPath(record, source),
          ]),
        );
        return config.includeOriginal ? { ...record, ...mapped } : mapped;
      }),
    };
  }
}

const conditionConfigSchema = z.object({
  field: z.string().min(1),
  operator: z.enum([
    'equals',
    'notEquals',
    'greaterThan',
    'greaterThanOrEqual',
    'lessThan',
    'lessThanOrEqual',
    'contains',
    'exists',
  ]),
  value: z.unknown().optional(),
});

export class ConditionPipe implements TransformPipe {
  readonly type = 'transform.condition';
  readonly role = 'transform';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Condition',
      // Branching belongs to Logic; the `transform.` type id is frozen so
      // saved workflows keep resolving (same precedent as source.trigger.cron).
      category: 'Logic',
      version: '0.2.0',
      role: 'transform',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [
        { name: 'true', type: 'records' },
        { name: 'false', type: 'records' },
      ],
      configSchema: conditionConfigSchema,
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    conditionConfigSchema.parse(config);
  }

  async transform(
    batch: RecordBatch,
    context: PipeContext,
  ): Promise<Map<string, RecordBatch>> {
    const config = conditionConfigSchema.parse(context.pipe.config);
    return splitBatch(batch, (record) =>
      compare(getPath(record, config.field), config.operator, config.value)
        ? 'true'
        : 'false',
    );
  }
}

function compare(
  actual: unknown,
  operator: z.infer<typeof conditionConfigSchema>['operator'],
  expected: unknown,
): boolean {
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'notEquals':
      return actual !== expected;
    case 'greaterThan':
      return comparable(actual) > comparable(expected);
    case 'greaterThanOrEqual':
      return comparable(actual) >= comparable(expected);
    case 'lessThan':
      return comparable(actual) < comparable(expected);
    case 'lessThanOrEqual':
      return comparable(actual) <= comparable(expected);
    case 'contains':
      return typeof actual === 'string'
        ? actual.includes(String(expected))
        : Array.isArray(actual) && actual.includes(expected);
    case 'exists':
      return actual !== undefined && actual !== null;
  }
}

function comparable(value: unknown): number | string {
  if (typeof value === 'number' || typeof value === 'string') return value;
  return String(value);
}
