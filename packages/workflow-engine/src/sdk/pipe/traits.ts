/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/traits.ts).
 */
import * as z from 'zod';

/**
 * Settings that recur across pipes because they describe the *engine's*
 * cross-cutting behaviour, not anything specific to one connector: how much to
 * read at a time, what to do with a record that fails, how many units of work
 * to run at once.
 *
 * Each is published here as a Zod field fragment to spread into a pipe's own
 * `z.object({...})`, the same way `columnRuleFieldsSchema` is shared between
 * the text source and the preview route. Spreading (rather than inheriting a
 * base object) keeps each pipe's schema a single flat object, which is what
 * `definePipeMetadata` needs to render one form.
 *
 * A pipe that needs different bounds passes them in. A pipe that needs
 * different *semantics* should write its own field rather than bend one of
 * these — the point is that identical names mean identical things.
 */

/** How a pipe treats a record it cannot process. */
export const ERROR_POLICIES = ['fail', 'skip'] as const;

/**
 * As {@link ERROR_POLICIES}, plus dead-lettering. Only for pipes that declare
 * a `rejects` output — `reject` with nowhere to route is a silent drop.
 */
export const REJECT_POLICIES = ['fail', 'skip', 'reject'] as const;

export type ErrorPolicy = (typeof ERROR_POLICIES)[number];
export type RejectPolicy = (typeof REJECT_POLICIES)[number];

/** Name of the dead-letter output port. */
export const REJECTS_PORT = 'rejects';

/**
 * Records per emitted batch. `max` is the pipe's own ceiling — a Postgres
 * keyset read and a CSV scan do not want the same upper bound.
 */
export function batchSizeField(options: { max?: number; default?: number } = {}) {
  return {
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(options.max ?? 100_000)
      .default(options.default ?? 1_000),
  };
}

/** Fail the run or drop the record. */
export const errorPolicyField = {
  onError: z.enum(ERROR_POLICIES).default('fail'),
};

/** Fail the run, drop the record, or send it out the `rejects` port. */
export const rejectPolicyField = {
  onInvalid: z.enum(REJECT_POLICIES).default('fail'),
};

/**
 * A JSON Schema every record must satisfy. `schemaSource` holds the Zod the
 * designer compiled it from so the author can edit it again — the runtime
 * never evaluates that source.
 */
export const recordContractFields = {
  schema: z.record(z.string(), z.unknown()).optional(),
  schemaSource: z.string().optional(),
};

/**
 * Units of work run at once *within* one batch — distinct from `pipe.
 * concurrency`, which is about batches in flight. `max` is per pipe: paid API
 * calls want a far lower ceiling than local writes.
 */
export function concurrencyField(options: { max?: number; default?: number } = {}) {
  return {
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(options.max ?? 16)
      .default(options.default ?? 1),
  };
}

/** Outcome of {@link mapRecordsConcurrently}, index-aligned with the input. */
export interface ConcurrentMapResult<T> {
  /** Successful results by input index; holes where the worker failed. */
  results: (T | undefined)[];
  /** Errors by input index; holes where the worker succeeded. */
  failures: (unknown | undefined)[];
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving input
 * order in the result.
 *
 * Order matters even though the workers finish out of order: a run that emits
 * records in completion order is not reproducible, and a re-run would produce
 * a differently-ordered batch with the same id.
 *
 * `onFailure: 'throw'` stops workers from claiming further items as soon as one
 * fails and rethrows — for a pipe where each item costs money or an external
 * write, letting siblings continue past a fatal error is waste. `'collect'`
 * records the error against its index and carries on, which is what a pipe with
 * a skip or dead-letter policy needs.
 */
export async function mapRecordsConcurrently<In, Out>(
  items: readonly In[],
  limit: number,
  worker: (item: In, index: number) => Promise<Out>,
  options: { onFailure?: 'throw' | 'collect' } = {},
): Promise<ConcurrentMapResult<Out>> {
  const results: (Out | undefined)[] = new Array(items.length);
  const failures: (unknown | undefined)[] = new Array(items.length);
  const onFailure = options.onFailure ?? 'throw';

  let next = 0;
  let aborted: { error: unknown } | undefined;

  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (aborted === undefined) {
        const index = next++;
        if (index >= items.length) return;
        try {
          results[index] = await worker(items[index]!, index);
        } catch (error) {
          if (onFailure === 'throw') {
            aborted = { error };
            return;
          }
          failures[index] = error;
        }
      }
    },
  );

  await Promise.all(runners);
  if (aborted !== undefined) throw aborted.error;
  return { results, failures };
}
