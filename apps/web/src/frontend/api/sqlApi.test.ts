import { describe, expect, it } from 'vitest';
import { parseSqlStatementResult } from './sqlApi';

describe('parseSqlStatementResult', () => {
  it('accepts ok and error payloads', () => {
    expect(
      parseSqlStatementResult({
        ok: true,
        columns: ['a'],
        rows: [[1]],
        rowCount: 1,
        truncated: false,
        durationMs: 12,
      })
    ).toEqual({
      ok: true,
      value: {
        ok: true,
        columns: ['a'],
        rows: [[1]],
        rowCount: 1,
        truncated: false,
        hasNext: false,
        durationMs: 12,
      },
    });

    expect(
      parseSqlStatementResult({ ok: false, error: 'boom', durationMs: 3 })
    ).toEqual({
      ok: true,
      value: { ok: false, error: 'boom', durationMs: 3 },
    });
  });

  it('rejects malformed success grids', () => {
    expect(
      parseSqlStatementResult({
        ok: true,
        columns: ['a'],
        rows: [1],
        rowCount: 1,
        truncated: false,
        durationMs: 1,
      }).ok
    ).toBe(false);
    expect(parseSqlStatementResult({ ok: true, durationMs: 1 }).ok).toBe(false);
    expect(parseSqlStatementResult({ ok: false, durationMs: 1 }).ok).toBe(false);
  });
});
