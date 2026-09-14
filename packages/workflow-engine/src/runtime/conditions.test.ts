/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/conditions.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { evaluateConditions } from './conditions.js';
import type { TriggerCondition } from '../common/index.js';

/**
 * One vocabulary for "only run when…", across three sources of truth: the
 * event itself, a database, and another service.
 */

const sqlBase = {
  check: 'sql' as const,
  credentialId: 'db',
  engine: 'postgres' as const,
  query: 'select * from orders where status = 1',
  timeoutMs: 5_000,
  maxRows: 1_000,
};

const httpBase = {
  check: 'http' as const,
  request: { url: 'https://flags.test/go', method: 'GET' } as never,
  timeoutMs: 5_000,
};

function ok(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } })) as never;
}

describe('payload conditions', () => {
  it('lets an interesting event through and stops a dull one', async () => {
    const conditions: TriggerCondition[] = [
      { check: 'payload', path: 'order.total', op: 'gte', value: 100 },
    ];

    expect(
      (await evaluateConditions(conditions, { payload: { order: { total: 250 } } })).met,
    ).toBe(true);
    expect(
      (await evaluateConditions(conditions, { payload: { order: { total: 5 } } })).met,
    ).toBe(false);
  });

  it('names which condition refused', async () => {
    // The run is absent by design; without this the only evidence that a
    // webhook arrived and was dropped is silence.
    const outcome = await evaluateConditions(
      [{ check: 'payload', path: 'type', op: 'equals', value: 'paid' }],
      { payload: { type: 'refunded' } },
    );

    expect(outcome.failed).toBe('payload type equals');
  });

  it('fails rather than throws on a missing path', async () => {
    const outcome = await evaluateConditions(
      [{ check: 'payload', path: 'deeply.absent.thing', op: 'exists' }],
      { payload: {} },
    );

    expect(outcome.met).toBe(false);
  });
});

describe('sql conditions', () => {
  it('counts rows without needing count(*) in the query', async () => {
    const sql = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);

    // `rowCount` is synthetic — the common question is "is there anything?",
    // and making every author write a count wrapper invites mistakes.
    const outcome = await evaluateConditions(
      [{ ...sqlBase, expect: { path: 'rowCount', op: 'gte', value: 2 } }],
      { payload: {}, sql },
    );

    expect(outcome.met).toBe(true);
  });

  it('reads a named column from the first row', async () => {
    const sql = vi.fn().mockResolvedValue([{ status: 'ready' }]);

    const outcome = await evaluateConditions(
      [{ ...sqlBase, expect: { path: 'status', op: 'equals', value: 'ready' } }],
      { payload: {}, sql },
    );

    expect(outcome.met).toBe(true);
  });

  it('hands rows on when asked, so the workflow need not refetch', async () => {
    const sql = vi.fn().mockResolvedValue([{ id: 7 }]);

    const outcome = await evaluateConditions(
      [{ ...sqlBase, expect: { op: 'gte', value: 1 }, passAs: 'orders' }],
      { payload: {}, sql },
    );

    expect(outcome.collected).toEqual({ orders: [{ id: 7 }] });
  });

  it('refuses a query that is not a read, before running it', async () => {
    const sql = vi.fn();

    await expect(
      evaluateConditions(
        [{ ...sqlBase, query: 'DELETE FROM orders', expect: { op: 'gte', value: 1 } }],
        { payload: {}, sql },
      ),
    ).rejects.toThrow(/SELECT or WITH/);
    expect(sql).not.toHaveBeenCalled();
  });

  it('throws when nothing can evaluate it', async () => {
    // Guessing either way is worse: "met" runs what the gate holds back,
    // "unmet" stops a schedule forever with no explanation.
    await expect(
      evaluateConditions(
        [{ ...sqlBase, expect: { op: 'gte', value: 1 } }],
        { payload: {} },
      ),
    ).rejects.toThrow(/no SQL probe/);
  });
});

describe('http conditions', () => {
  it('tests the status when no path is given', async () => {
    const outcome = await evaluateConditions(
      [{ ...httpBase, expect: { op: 'equals', value: 200 } }],
      { payload: {}, fetch: ok('{}') },
    );

    expect(outcome.met).toBe(true);
  });

  it('reads into a JSON body', async () => {
    const outcome = await evaluateConditions(
      [{ ...httpBase, expect: { path: 'body.enabled', op: 'equals', value: true } }],
      { payload: {}, fetch: ok(JSON.stringify({ enabled: true })) },
    );

    expect(outcome.met).toBe(true);
  });

  it('treats a non-JSON body as text rather than failing', async () => {
    // A health endpoint answering `ok` is as valid a gate as one answering
    // JSON, and throwing on it would make the gate the outage.
    const outcome = await evaluateConditions(
      [{ ...httpBase, expect: { path: 'body', op: 'equals', value: 'ok' } }],
      { payload: {}, fetch: ok('ok') },
    );

    expect(outcome.met).toBe(true);
  });
});

describe('several conditions together', () => {
  it('stops at the first failure and does not ask the rest', async () => {
    const sql = vi.fn();

    const outcome = await evaluateConditions(
      [
        { check: 'payload', path: 'type', op: 'equals', value: 'paid' },
        { ...sqlBase, expect: { op: 'gte', value: 1 } },
      ],
      { payload: { type: 'refunded' }, sql },
    );

    expect(outcome.met).toBe(false);
    // A cheap check that already said no should not cost a database round
    // trip — conditions run before every accepted event.
    expect(sql).not.toHaveBeenCalled();
  });

  it('collects from every condition that passed', async () => {
    const outcome = await evaluateConditions(
      [
        { ...sqlBase, expect: { op: 'gte', value: 1 }, passAs: 'rows' },
        { ...httpBase, expect: { op: 'equals', value: 200 }, passAs: 'flags' },
      ],
      {
        payload: {},
        sql: vi.fn().mockResolvedValue([{ id: 1 }]),
        fetch: ok(JSON.stringify({ beta: true })),
      },
    );

    expect(outcome.met).toBe(true);
    expect(outcome.collected).toEqual({ rows: [{ id: 1 }], flags: { beta: true } });
  });
});
