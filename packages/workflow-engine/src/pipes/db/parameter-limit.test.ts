/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/db/src/parameter-limit.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { chunkForParameterLimit } from './postgres.js';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe('chunkForParameterLimit', () => {
  it('leaves a batch that fits in one statement alone', () => {
    // 1,000 rows x 5 columns = 5,000 parameters, well under the limit.
    expect(chunkForParameterLimit(rows(1_000), 5)).toHaveLength(1);
  });

  it('splits a batch that would exceed the 65535 parameter limit', () => {
    // The case that failed against a real database: 8,000 x 10 = 80,000
    // parameters, which wrapped the 16-bit count and produced a bind error
    // naming neither the limit nor the cause.
    const chunks = chunkForParameterLimit(rows(8_000), 10);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length * 10).toBeLessThanOrEqual(65_535);
    }
  });

  it('keeps every row exactly once and in order', () => {
    // Splitting a write must not lose or duplicate a row.
    const source = rows(20_000);
    const flattened = chunkForParameterLimit(source, 8).flat();

    expect(flattened).toEqual(source);
  });

  it('still emits one row per statement for an absurdly wide table', () => {
    // More columns than the parameter budget: one row per statement is the
    // most that can be done, and is better than a query the server rejects.
    const chunks = chunkForParameterLimit(rows(3), 70_000);

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length === 1)).toBe(true);
  });

  it('handles an empty batch and a zero column count', () => {
    expect(chunkForParameterLimit([], 5)).toEqual([[]]);
    expect(chunkForParameterLimit([], 0)).toEqual([]);
  });
});
