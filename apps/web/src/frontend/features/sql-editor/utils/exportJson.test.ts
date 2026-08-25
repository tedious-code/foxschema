import { describe, expect, it } from 'vitest';
import { toJson, toJsonRows, uniqueKeys } from '@/features/sql-editor/utils/exportJson';

describe('uniqueKeys — a result set may repeat a column name', () => {
  it('leaves distinct names alone', () => {
    expect(uniqueKeys(['id', 'name'])).toEqual(['id', 'name']);
  });

  it('suffixes duplicates instead of dropping a value', () => {
    // SELECT a.id, b.id — without this the second id would overwrite the first.
    expect(uniqueKeys(['id', 'id', 'id'])).toEqual(['id', 'id_2', 'id_3']);
  });

  it('does not collide with a literal name that matches the suffix form', () => {
    expect(uniqueKeys(['id', 'id_2', 'id'])).toEqual(['id', 'id_2', 'id_3']);
  });

  it('names an empty column by position', () => {
    expect(uniqueKeys(['', 'name'])).toEqual(['column_1', 'name']);
  });
});

describe('toJsonRows — shape and coercion', () => {
  it('keys each row by column name, in the given order', () => {
    expect(toJsonRows(['b', 'a'], [[2, 1]])).toEqual([{ b: 2, a: 1 }]);
  });

  it('keeps SQL NULL as null rather than dropping the key', () => {
    expect(toJsonRows(['a'], [[null]])).toEqual([{ a: null }]);
  });

  it('fills a short row with null instead of undefined', () => {
    // undefined would vanish from JSON.stringify, changing the object's shape.
    expect(toJsonRows(['a', 'b'], [[1]])).toEqual([{ a: 1, b: null }]);
  });

  it('preserves zero and false', () => {
    expect(toJsonRows(['a', 'b'], [[0, false]])).toEqual([{ a: 0, b: false }]);
  });

  it('renders bigint as a string so precision survives', () => {
    // A number would round past 2^53; plain JSON.stringify would throw.
    expect(toJsonRows(['n'], [[9007199254740993n]])).toEqual([{ n: '9007199254740993' }]);
  });

  it('renders Date as ISO', () => {
    const d = new Date('2026-08-09T12:00:00.000Z');
    expect(toJsonRows(['at'], [[d]])).toEqual([{ at: '2026-08-09T12:00:00.000Z' }]);
  });

  it('returns an empty array for no rows', () => {
    expect(toJsonRows(['a'], [])).toEqual([]);
  });
});

describe('toJson — output', () => {
  it('does not throw on a bigint value', () => {
    expect(() => toJson(['n'], [[1n]])).not.toThrow();
  });

  it('pretty-prints an array of objects', () => {
    expect(toJson(['a'], [[1]])).toBe('[\n  {\n    "a": 1\n  }\n]');
  });

  it('emits an empty array for no rows', () => {
    expect(toJson(['a'], [])).toBe('[]');
  });

  it('round-trips through JSON.parse', () => {
    const parsed = JSON.parse(toJson(['id', 'name'], [[1, 'a'], [2, null]]));
    expect(parsed).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: null },
    ]);
  });
});
