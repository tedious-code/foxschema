/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The cases that matter here are the ones where a naive sort is wrong in a way
 * the reader would not notice: numbers arriving as strings from the driver,
 * NULLs drifting to the top, and a filter that quietly matches nothing because
 * the cell is NULL rather than empty.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGridView,
  cellMatches,
  compareCells,
  nextSort,
  operatorNeedsValue,
  viewIsActive,
  type GridFilter,
} from './gridView';

const filter = (column: number, operator: GridFilter['operator'], value?: string): GridFilter =>
  value === undefined ? { column, operator } : { column, operator, value };

describe('compareCells', () => {
  it('sorts numbers numerically even when the driver sent them as strings', () => {
    // pg returns NUMERIC as a string. Compared as text "10" sorts before "9";
    // compared as numbers 9 comes first, which is what a price column needs.
    expect(compareCells('9', '10', 'asc')).toBeLessThan(0);
    expect(compareCells(9, 10, 'asc')).toBeLessThan(0);
    expect('9'.localeCompare('10')).toBeGreaterThan(0); // the behaviour avoided
  });

  it('puts NULL last whichever way the sort runs', () => {
    // Flipping NULLs with the direction hides them at the top half the time.
    expect(compareCells(null, 5, 'asc')).toBeGreaterThan(0);
    expect(compareCells(null, 5, 'desc')).toBeGreaterThan(0);
    expect(compareCells(5, null, 'desc')).toBeLessThan(0);
  });

  it('treats two NULLs as equal', () => {
    expect(compareCells(null, undefined, 'asc')).toBe(0);
  });

  it('orders mixed identifiers the way a reader reads them', () => {
    expect(compareCells('item2', 'item10', 'asc')).toBeLessThan(0);
  });

  it('reverses for desc', () => {
    expect(compareCells('a', 'b', 'desc')).toBeGreaterThan(0);
  });

  it('does not treat an empty string as the number zero', () => {
    // Number('') is 0. Against a negative that difference is visible: as a
    // number a blank would sort *after* -5, as text it sorts before. Blanks
    // belong with the text, not among the numbers.
    expect(compareCells('', '-5', 'asc')).toBeLessThan(0);
  });
});

describe('cellMatches', () => {
  it('matches text case-insensitively', () => {
    expect(cellMatches('Ada Lovelace', filter(0, 'contains', 'ada'))).toBe(true);
    expect(cellMatches('Ada', filter(0, 'equals', 'ADA'))).toBe(true);
  });

  it('separates NULL from an empty string', () => {
    // The grid shows NULL as a word; a `contains` on it must not match text.
    expect(cellMatches(null, filter(0, 'isNull'))).toBe(true);
    expect(cellMatches('', filter(0, 'isNull'))).toBe(false);
    expect(cellMatches(null, filter(0, 'contains', ''))).toBe(false);
    expect(cellMatches(null, filter(0, 'isNotNull'))).toBe(false);
  });

  it('compares numerically when both sides are numbers', () => {
    expect(cellMatches(9, filter(0, 'lt', '10'))).toBe(true);
    expect(cellMatches('9', filter(0, 'lt', '10'))).toBe(true); // string from driver
  });

  it('still answers an ordering question on text', () => {
    expect(cellMatches('banana', filter(0, 'gt', 'apple'))).toBe(true);
  });

  it.each([
    ['startsWith', 'Ada', true],
    ['endsWith', 'lace', true],
    ['notEquals', 'Grace', true],
  ] as const)('%s works', (op, value, expected) => {
    expect(cellMatches('Ada Lovelace', filter(0, op, value))).toBe(expected);
  });

  it('knows which operators need a value at all', () => {
    expect(operatorNeedsValue('isNull')).toBe(false);
    expect(operatorNeedsValue('contains')).toBe(true);
  });
});

describe('applyGridView', () => {
  const rows = [
    [3, 'Cara', null],
    [1, 'Ada', 'x'],
    [2, 'Bob', 'y'],
  ];

  it('returns indices, not rows, so selection stays tied to the record', () => {
    const out = applyGridView(rows, { sort: { column: 0, direction: 'asc' }, filters: [] });
    expect(out).toEqual([1, 2, 0]);
  });

  it('filters then sorts', () => {
    const out = applyGridView(rows, {
      sort: { column: 0, direction: 'desc' },
      filters: [filter(2, 'isNotNull')],
    });
    expect(out).toEqual([2, 1]);
  });

  it('ignores a filter whose value is still empty', () => {
    // Typing in a filter box should not blank the grid before a value exists.
    const out = applyGridView(rows, { sort: null, filters: [filter(1, 'contains', '')] });
    expect(out).toHaveLength(3);
  });

  it('applies every filter, not just the first', () => {
    const out = applyGridView(rows, {
      sort: null,
      filters: [filter(2, 'isNotNull'), filter(0, 'gt', '1')],
    });
    expect(out).toEqual([2]);
  });

  it('is a no-op when nothing is set', () => {
    expect(applyGridView(rows, { sort: null, filters: [] })).toEqual([0, 1, 2]);
  });

  it('keeps ties in the order the database returned them', () => {
    const tied = [['a', 1], ['a', 2], ['a', 3]];
    const out = applyGridView(tied, { sort: { column: 0, direction: 'asc' }, filters: [] });
    expect(out).toEqual([0, 1, 2]);
  });
});

describe('nextSort', () => {
  it('cycles asc → desc → off on the same column', () => {
    let s = nextSort(null, 2);
    expect(s).toEqual({ column: 2, direction: 'asc' });
    s = nextSort(s, 2);
    expect(s).toEqual({ column: 2, direction: 'desc' });
    expect(nextSort(s, 2)).toBeNull();
  });

  it('starts fresh on a different column', () => {
    expect(nextSort({ column: 1, direction: 'desc' }, 3)).toEqual({ column: 3, direction: 'asc' });
  });
});

describe('viewIsActive', () => {
  it('is false only when nothing is set', () => {
    expect(viewIsActive({ sort: null, filters: [] })).toBe(false);
    expect(viewIsActive({ sort: { column: 0, direction: 'asc' }, filters: [] })).toBe(true);
    expect(viewIsActive({ sort: null, filters: [filter(0, 'isNull')] })).toBe(true);
  });
});
