import { describe, expect, it } from 'vitest';
import { normalizeResultValue } from './resultValueKey';
import { resultValuesEqual } from './resultDataDiff';
import { classifyRowsByKey } from './resultRowDiff';

describe('normalizeResultValue — dialect representations fold', () => {
  it('folds booleans onto 1/0 so pg boolean meets mysql TINYINT(1)', () => {
    expect(normalizeResultValue(true)).toBe('1');
    expect(normalizeResultValue(false)).toBe('0');
    expect(resultValuesEqual(true, 1)).toBe(true);
    expect(resultValuesEqual(false, 0)).toBe(true);
    expect(resultValuesEqual(true, '1')).toBe(true);
    // Still a real difference, not a representation one.
    expect(resultValuesEqual(true, 0)).toBe(false);
  });

  it('folds DECIMAL scale differences', () => {
    expect(resultValuesEqual('1.50', '1.5')).toBe(true);
    expect(resultValuesEqual('2.0', 2)).toBe(true);
    expect(resultValuesEqual('1.51', '1.5')).toBe(false);
  });

  it('folds bigint and Date representations', () => {
    expect(resultValuesEqual(10n, '10')).toBe(true);
    expect(resultValuesEqual(new Date('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z')).toBe(
      true
    );
  });

  it('ignores JSON key order (pg jsonb reorders, json does not)', () => {
    expect(resultValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(resultValuesEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('normalizeResultValue — real differences survive', () => {
  it('keeps zero-padded text distinct from its numeric value', () => {
    // The whole reason numeric folding is restricted to canonical form: '007'
    // in a text key is a different value from 7, and folding them would pair
    // unrelated rows — the bug this module was written to fix.
    expect(resultValuesEqual('007', 7)).toBe(false);
    expect(resultValuesEqual('007', '7')).toBe(false);
  });

  it('keeps exponent text distinct (never a driver numeric rendering)', () => {
    expect(resultValuesEqual('1e3', 1000)).toBe(false);
  });

  it('keeps NULL apart from empty string and zero', () => {
    expect(resultValuesEqual(null, '')).toBe(false);
    expect(resultValuesEqual(null, 0)).toBe(false);
    expect(resultValuesEqual(null, undefined)).toBe(true);
  });

  it('does not fold whitespace-padded numerics', () => {
    expect(resultValuesEqual(' 1', 1)).toBe(false);
  });
});

describe('classifyRowsByKey — object-valued keys', () => {
  const grid = (rows: unknown[][]) => ({ columns: ['id', 'v'], rows });

  it('treats distinct object keys as distinct rows', () => {
    // Regression: String({x:1}) and String({x:2}) both gave "[object Object]",
    // so these matched and produced an UPDATE that overwrote the wrong row.
    const r = classifyRowsByKey({
      source: grid([[{ x: 1 }, 'src']]),
      dest: grid([[{ x: 2 }, 'dst']]),
      keyNames: ['id'],
    });
    expect(r.updates).toHaveLength(0);
    expect(r.inserts).toHaveLength(1);
    expect(r.deletes).toHaveLength(1);
    expect(r.inserts[0]!.keyLabel).not.toContain('[object Object]');
  });

  it('still matches equal object keys regardless of property order', () => {
    const r = classifyRowsByKey({
      source: grid([[{ a: 1, b: 2 }, 'same']]),
      dest: grid([[{ b: 2, a: 1 }, 'same']]),
      keyNames: ['id'],
    });
    expect(r.totalOps).toBe(0);
  });

  it('matches a boolean key against its 1/0 counterpart across dialects', () => {
    const r = classifyRowsByKey({
      source: { columns: ['flag', 'v'], rows: [[true, 'x']] },
      dest: { columns: ['flag', 'v'], rows: [[1, 'x']] },
      keyNames: ['flag'],
    });
    expect(r.totalOps).toBe(0);
  });

  it('still refuses NULL keys', () => {
    const r = classifyRowsByKey({
      source: grid([[null, 'src']]),
      dest: grid([]),
      keyNames: ['id'],
    });
    expect(r.skippedNullKeys).toBe(1);
    expect(r.totalOps).toBe(0);
  });
});
