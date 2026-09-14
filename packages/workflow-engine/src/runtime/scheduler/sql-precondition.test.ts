/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/scheduler/sql-precondition.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertReadOnly,
  evaluatePrecondition,
  meetsExpectation,
  type SqlPrecondition,
} from './sql-precondition.js';

function precondition(
  overrides: Partial<SqlPrecondition> = {},
): SqlPrecondition {
  return {
    credentialId: 'db',
    engine: 'postgres',
    query: 'select count(*) as n from orders where status = 1',
    expect: { mode: 'nonEmpty' },
    passRowsAsPayload: false,
    timeoutMs: 5_000,
    maxRows: 1_000,
    ...overrides,
  };
}

describe('refusing anything that is not a read', () => {
  it('allows a plain select and a CTE', () => {
    expect(() => assertReadOnly('SELECT 1')).not.toThrow();
    expect(() => assertReadOnly('with t as (select 1) select * from t')).not.toThrow();
  });

  it('refuses statements that change data', () => {
    // The likely mistake: pasting a mutation into a box that runs every 30s.
    for (const sql of [
      'DELETE FROM orders',
      'update orders set status = 2',
      'INSERT INTO audit VALUES (1)',
      'TRUNCATE orders',
      'drop table orders',
    ]) {
      expect(() => assertReadOnly(sql), sql).toThrow(/SELECT or WITH/);
    }
  });

  it('refuses a mutation hidden behind a comment', () => {
    // `-- harmless\nDELETE ...` starts with a comment, not a verb.
    expect(() => assertReadOnly('-- nightly cleanup\nDELETE FROM orders')).toThrow();
    expect(() => assertReadOnly('/* check */ TRUNCATE orders')).toThrow();
  });

  it('refuses stacked statements that open with a select', () => {
    // `SELECT 1; DROP TABLE x` passes a naive "starts with select" check.
    expect(() => assertReadOnly('SELECT 1; DROP TABLE orders')).toThrow(
      /single statement/,
    );
  });

  it('allows a single trailing semicolon', () => {
    expect(() => assertReadOnly('SELECT 1;')).not.toThrow();
  });
});

describe('deciding whether there is anything to do', () => {
  it('nonEmpty and empty read the row count', () => {
    expect(meetsExpectation([{ n: 1 }], { mode: 'nonEmpty' })).toBe(true);
    expect(meetsExpectation([], { mode: 'nonEmpty' })).toBe(false);
    expect(meetsExpectation([], { mode: 'empty' })).toBe(true);
  });

  it('equals and atLeast read a value from the first row', () => {
    const rows = [{ n: 5, label: 'ready' }];

    expect(meetsExpectation(rows, { mode: 'equals', column: 'label', value: 'ready' })).toBe(true);
    expect(meetsExpectation(rows, { mode: 'equals', column: 'label', value: 'done' })).toBe(false);
    expect(meetsExpectation(rows, { mode: 'atLeast', column: 'n', value: 5 })).toBe(true);
    expect(meetsExpectation(rows, { mode: 'atLeast', column: 'n', value: 6 })).toBe(false);
  });

  it('defaults to the first column when none is named', () => {
    // `select count(*) from …` — the caller should not have to know that the
    // column came back as `count` or `?column?` depending on the engine.
    expect(meetsExpectation([{ count: 3 }], { mode: 'atLeast', value: 2 })).toBe(true);
  });

  it('treats no rows as an unmet expectation, not an error', () => {
    // An empty result is the *normal* case for a watch query; throwing would
    // turn every quiet minute into a scheduler error.
    expect(meetsExpectation([], { mode: 'atLeast', column: 'n', value: 1 })).toBe(false);
    expect(meetsExpectation([], { mode: 'equals', column: 'n', value: 0 })).toBe(false);
  });
});

describe('evaluating against a database', () => {
  it('passes the query and limits to the probe', async () => {
    const probe = vi.fn().mockResolvedValue([{ n: 2 }]);

    const outcome = await evaluatePrecondition(
      precondition({ expect: { mode: 'atLeast', value: 1 } }),
      probe,
    );

    expect(outcome).toEqual({ met: true, rows: [{ n: 2 }] });
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'db', engine: 'postgres', timeoutMs: 5_000, maxRows: 1_000 }),
    );
  });

  it('checks the query is read-only before running it', async () => {
    const probe = vi.fn();

    await expect(
      evaluatePrecondition(precondition({ query: 'DELETE FROM orders' }), probe),
    ).rejects.toThrow(/SELECT or WITH/);
    // Never reached the database at all.
    expect(probe).not.toHaveBeenCalled();
  });

  it('fails loudly when no probe is wired rather than running anyway', async () => {
    // The alternative — treating an unevaluable precondition as "met" — would
    // silently run the workflow the gate exists to hold back.
    await expect(
      evaluatePrecondition(precondition(), undefined),
    ).rejects.toThrow(/no SQL probe/);
  });
});
