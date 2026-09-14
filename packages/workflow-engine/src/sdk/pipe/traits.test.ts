/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/traits.test.ts).
 */
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import {
  batchSizeField,
  concurrencyField,
  errorPolicyField,
  mapRecordsConcurrently,
  recordContractFields,
  rejectPolicyField,
} from './traits.js';

describe('config field traits', () => {
  it('compose into a flat pipe schema with shared defaults', () => {
    const schema = z.object({
      path: z.string(),
      ...batchSizeField(),
      ...recordContractFields,
      ...rejectPolicyField,
    });

    expect(schema.parse({ path: 'a.csv' })).toEqual({
      path: 'a.csv',
      batchSize: 1_000,
      onInvalid: 'fail',
    });
  });

  it('lets a pipe tighten a bound without redefining the field', () => {
    const schema = z.object(batchSizeField({ max: 10_000 }));

    expect(schema.parse({ batchSize: 10_000 }).batchSize).toBe(10_000);
    expect(() => schema.parse({ batchSize: 10_001 })).toThrow();
  });

  it('separates the two error vocabularies', () => {
    expect(() =>
      z.object(errorPolicyField).parse({ onError: 'reject' }),
    ).toThrow();
    expect(
      z.object(rejectPolicyField).parse({ onInvalid: 'reject' }).onInvalid,
    ).toBe('reject');
  });
});

describe('mapRecordsConcurrently', () => {
  it('returns results in input order regardless of completion order', async () => {
    // Reverse the delays so completion order is the opposite of input order.
    const items = [30, 20, 10];
    const { results } = await mapRecordsConcurrently(items, 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });

    expect(results).toEqual([30, 20, 10]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapRecordsConcurrently([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });

    expect(peak).toBe(3);
  });

  it('stops claiming work after a failure when told to throw', async () => {
    const started: number[] = [];

    await expect(
      mapRecordsConcurrently([0, 1, 2, 3, 4, 5], 1, async (item) => {
        started.push(item);
        if (item === 1) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Serial pool: it must not have gone on to claim items 2..5.
    expect(started).toEqual([0, 1]);
  });

  it('collects failures by index and keeps going', async () => {
    const { results, failures } = await mapRecordsConcurrently(
      ['a', 'b', 'c'],
      2,
      async (item) => {
        if (item === 'b') throw new Error('bad b');
        return item.toUpperCase();
      },
      { onFailure: 'collect' },
    );

    expect(results[0]).toBe('A');
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBe('C');
    expect((failures[1] as Error).message).toBe('bad b');
    expect(failures[0]).toBeUndefined();
  });

  it('handles an empty input without spawning a worker', async () => {
    let calls = 0;
    const { results } = await mapRecordsConcurrently([], 4, async () => {
      calls += 1;
    });

    expect(calls).toBe(0);
    expect(results).toEqual([]);
  });
});
