/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * How a generated GRANT / REVOKE script is cut into statements.
 *
 * Both cases here are ones a `split(/;\s*(?:\n+|$)/)` gets wrong, and both are
 * shapes an emitter or a real identifier produces — a one-line pair, and a
 * semicolon living inside quotes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAccessSql } from './accessSql';

const executeSql = vi.hoisted(() => vi.fn());
vi.mock('./sqlApi', () => ({ executeSql }));

const ref = { connectionId: 'c1' };
const sent = () => executeSql.mock.calls[0]![1] as string[];

describe('runAccessSql', () => {
  beforeEach(() => {
    executeSql.mockReset();
    executeSql.mockResolvedValue({ results: [{ ok: true }] });
  });

  it('splits a pair written on one line', async () => {
    // Emitters join with '; ' as often as with a newline; a splitter that
    // needs the newline sends both as one statement and the driver rejects it.
    await runAccessSql(ref, 'GRANT USAGE ON SCHEMA app TO r; GRANT SELECT ON ALL TABLES IN SCHEMA app TO r;');
    expect(sent()).toEqual([
      'GRANT USAGE ON SCHEMA app TO r;',
      'GRANT SELECT ON ALL TABLES IN SCHEMA app TO r;',
    ]);
  });

  it('keeps a semicolon that is inside quotes', async () => {
    // The identifier is the object being granted on. Cutting it in half sends
    // two statements that are each invalid, against an object that exists.
    await runAccessSql(ref, `GRANT SELECT ON "audit;2024" TO app;`);
    expect(sent()).toEqual([`GRANT SELECT ON "audit;2024" TO app;`]);
  });

  it('splits a multi-line script and drops blank trailing text', async () => {
    await runAccessSql(ref, 'GRANT SELECT ON t TO r;\n\nGRANT INSERT ON t TO r;\n');
    expect(sent()).toEqual(['GRANT SELECT ON t TO r;', 'GRANT INSERT ON t TO r;']);
  });

  it('sends the original text when nothing splits out of it', async () => {
    await runAccessSql(ref, 'GRANT SELECT ON t TO r');
    expect(sent()).toEqual(['GRANT SELECT ON t TO r']);
  });

  it('joins the errors of the statements that failed', async () => {
    executeSql.mockResolvedValue({
      results: [{ ok: true }, { ok: false, error: 'role "r" does not exist' }],
    });
    await expect(runAccessSql(ref, 'GRANT SELECT ON t TO r;\nGRANT INSERT ON t TO r;')).resolves.toEqual({
      ok: false,
      error: 'role "r" does not exist',
    });
  });

  it('reports ok only when every statement succeeded', async () => {
    executeSql.mockResolvedValue({ results: [{ ok: true }, { ok: true }] });
    await expect(runAccessSql(ref, 'GRANT SELECT ON t TO r;\nGRANT INSERT ON t TO r;')).resolves.toEqual({
      ok: true,
    });
  });
});
