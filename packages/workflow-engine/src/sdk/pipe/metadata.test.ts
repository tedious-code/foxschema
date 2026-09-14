/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/metadata.test.ts).
 */
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { definePipeMetadata } from './metadata.js';

const base = {
  type: 'test.pipe',
  name: 'Test pipe',
  category: 'Transform',
  version: '1.0.0',
  role: 'transform' as const,
  inputs: [{ name: 'in', type: 'records' as const }],
  outputs: [{ name: 'out', type: 'records' as const }],
};

describe('definePipeMetadata', () => {
  it('derives the designer JSON Schema from a Zod config schema', () => {
    const meta = definePipeMetadata({
      ...base,
      configSchema: z.object({
        path: z.string().min(1),
        mode: z.enum(['fail', 'skip']).default('fail'),
      }),
    });

    expect(meta.configSchema).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        mode: { type: 'string', enum: ['fail', 'skip'], default: 'fail' },
      },
    });
  });

  it('treats a defaulted field as optional to supply', () => {
    // `io: 'input'` is the distinction that matters: after parsing, a
    // defaulted field is always present (and would be "required" in output
    // mode), but the author never has to write it.
    const meta = definePipeMetadata({
      ...base,
      configSchema: z.object({
        path: z.string(),
        batchSize: z.number().int().default(1_000),
      }),
    });

    expect(meta.configSchema.required).toEqual(['path']);
  });

  it('drops the safe-integer bounds .int() adds, keeping declared ones', () => {
    const meta = definePipeMetadata({
      ...base,
      configSchema: z.object({
        unbounded: z.number().int(),
        bounded: z.number().int().min(1).max(100),
      }),
    });
    const properties = meta.configSchema.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties.unbounded).toEqual({ type: 'integer' });
    expect(properties.bounded).toMatchObject({ minimum: 1, maximum: 100 });
  });

  it('derives a given schema once, however often metadata() is called', () => {
    // The executor reads `metadata().outputs` through `defaultOutputPort` once
    // per batch, per pipe — deriving on every call put a ~0.2ms conversion on
    // the streaming hot path.
    const configSchema = z.object({ path: z.string() });
    const first = definePipeMetadata({ ...base, configSchema }).configSchema;
    const second = definePipeMetadata({ ...base, configSchema }).configSchema;

    expect(second).toBe(first);
  });

  it('keeps a hand-written JSON Schema untouched', () => {
    const handWritten = {
      type: 'object',
      required: ['topic'],
      properties: { topic: { type: 'string' } },
    };
    const meta = definePipeMetadata({ ...base, configSchema: handWritten });

    expect(meta.configSchema).toEqual(handWritten);
  });

  it('drops Zod rules JSON Schema cannot express instead of throwing', () => {
    // A cross-field `.refine()` has no JSON Schema equivalent. The runtime
    // `parse` still enforces it; the designer simply cannot render it.
    const meta = definePipeMetadata({
      ...base,
      configSchema: z
        .object({ a: z.string().optional(), b: z.string().optional() })
        .refine((config) => Boolean(config.a ?? config.b), 'need one'),
    });

    expect(meta.configSchema).toMatchObject({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    });
  });
});
