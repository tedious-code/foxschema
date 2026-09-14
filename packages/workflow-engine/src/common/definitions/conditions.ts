/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/definitions/conditions.ts).
 */
import { z } from 'zod';
import { httpRequestSchema } from './http-request.js';
import { predicateOperatorSchema } from './predicate.js';

/**
 * "Only run when…" — asked before a run exists.
 *
 * Every trigger kind can carry conditions, and all of them must pass for the
 * run to be created. Checking inside the workflow cannot do this: by then the
 * run record exists, and a schedule that finds nothing to do a thousand times
 * a day has still written a thousand rows.
 *
 * The three checks answer different questions, so each declares what it needs
 * rather than sharing one config bag:
 *
 * - `payload` — is the event itself interesting? For webhook/http/parent,
 *   where something arrived. On a cron the payload is `{ scheduledAt }`,
 *   which is a legitimate thing to test but rarely a useful one.
 * - `sql` — does the database have work? For schedules that watch a table.
 * - `http` — does another service say go? For schedules gated on a health
 *   check, a feature flag, or a queue depth.
 *
 * `sql` and `http` cost a network round trip on every evaluation, so they
 * belong on schedules rather than on a webhook that fires per request.
 * Nothing enforces that — it is a cost, not a correctness rule.
 */

const expectationSchema = z.object({
  /** Dot path into the result. Omitted means the whole value. */
  path: z.string().min(1).optional(),
  op: predicateOperatorSchema,
  value: z.unknown().optional(),
});

export const conditionSchema = z.discriminatedUnion('check', [
  z.object({
    check: z.literal('payload'),
    /** Dot path into the trigger payload. */
    path: z.string().min(1),
    op: predicateOperatorSchema,
    value: z.unknown().optional(),
  }),
  z.object({
    check: z.literal('sql'),
    credentialId: z.string().min(1),
    engine: z.enum(['postgres', 'mysql']),
    /** Read-only; enforced, though the credential is the real boundary. */
    query: z.string().min(1).max(4000),
    /**
     * Tested against the first row. `rowCount` is a synthetic path so the
     * common case — "are there any" — needs no `count(*)` in the query.
     */
    expect: expectationSchema,
    timeoutMs: z.number().int().min(100).max(60_000).default(5_000),
    maxRows: z.number().int().min(1).max(10_000).default(1_000),
    /** Add the rows to the run's payload under this key. */
    passAs: z.string().min(1).optional(),
  }),
  z.object({
    check: z.literal('http'),
    request: httpRequestSchema,
    /** Tested against `{ status, body }` of the response. */
    expect: expectationSchema,
    timeoutMs: z.number().int().min(100).max(60_000).default(5_000),
    /** Add the response body to the run's payload under this key. */
    passAs: z.string().min(1).optional(),
  }),
]);

export type TriggerCondition = z.infer<typeof conditionSchema>;

/**
 * Capped because they run before every accepted event, in series. A trigger
 * needing more than a handful of gates is describing a workflow.
 *
 * Optional rather than defaulted: absent and empty both mean "no gates", so
 * requiring the key on every trigger would be churn without meaning. (Unlike
 * `WorkflowDef.origin`, where undefined could defeat a check.)
 */
export const conditionsSchema = z.array(conditionSchema).max(8).optional();
