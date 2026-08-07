/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  cellDiffKey,
  compareResultGrids,
  resultValuesEqual,
} from './resultDataDiff';

describe('resultValuesEqual', () => {
  it('treats null and undefined as equal', () => {
    expect(resultValuesEqual(null, null)).toBe(true);
    expect(resultValuesEqual(undefined, null)).toBe(true);
    expect(resultValuesEqual(null, 0)).toBe(false);
  });

  it('compares scalars and stringifies numbers loosely via String', () => {
    expect(resultValuesEqual(1, 1)).toBe(true);
    expect(resultValuesEqual(1, '1')).toBe(true);
    expect(resultValuesEqual('a', 'b')).toBe(false);
  });
});

describe('compareResultGrids', () => {
  it('marks modified cells on both grids for shared columns', () => {
    const baseline = {
      columns: ['id', 'name'],
      rows: [
        [1, 'alpha'],
        [2, 'beta'],
      ],
    };
    const other = {
      columns: ['id', 'name'],
      rows: [
        [1, 'alpha'],
        [2, 'BETA'],
      ],
    };
    const diff = compareResultGrids(baseline, other);
    expect(diff.baseline.cells.get(cellDiffKey(1, 1))).toBe('modified');
    expect(diff.other.cells.get(cellDiffKey(1, 1))).toBe('modified');
    expect(diff.baseline.cells.has(cellDiffKey(0, 0))).toBe(false);
    expect(diff.baseline.modified).toBe(1);
    expect(diff.other.modified).toBe(1);
  });

  it('matches columns case-insensitively regardless of order', () => {
    const baseline = { columns: ['ID', 'Name'], rows: [[1, 'a']] };
    const other = { columns: ['name', 'id'], rows: [['b', 1]] };
    const diff = compareResultGrids(baseline, other);
    // name differs; id same
    expect(diff.baseline.cells.get(cellDiffKey(0, 1))).toBe('modified');
    expect(diff.other.cells.get(cellDiffKey(0, 0))).toBe('modified');
  });

  it('marks missing/extra rows by index', () => {
    const baseline = {
      columns: ['id'],
      rows: [[1], [2], [3]],
    };
    const other = {
      columns: ['id'],
      rows: [[1], [2]],
    };
    const diff = compareResultGrids(baseline, other);
    expect(diff.baseline.cells.get(cellDiffKey(2, 0))).toBe('missing');
    expect(diff.other.cells.has(cellDiffKey(2, 0))).toBe(false);

    const flipped = compareResultGrids(other, baseline);
    expect(flipped.other.cells.get(cellDiffKey(2, 0))).toBe('extra');
  });

  it('tracks missing and extra columns', () => {
    const baseline = {
      columns: ['id', 'only_base'],
      rows: [[1, 'x']],
    };
    const other = {
      columns: ['id', 'only_other'],
      rows: [[1, 'y']],
    };
    const diff = compareResultGrids(baseline, other);
    expect(diff.baseline.missingColumns).toEqual(['only_base']);
    expect(diff.other.extraColumns).toEqual(['only_other']);
    expect(diff.baseline.cells.get(cellDiffKey(0, 1))).toBe('missing');
    expect(diff.other.cells.get(cellDiffKey(0, 1))).toBe('extra');
  });

  it('returns empty maps when grids match', () => {
    const g = { columns: ['a'], rows: [[1], [2]] };
    const diff = compareResultGrids(g, g);
    expect(diff.totalDiffCells).toBe(0);
    expect(diff.baseline.cells.size).toBe(0);
  });

  it('ignores trigger/audit columns when requested', () => {
    const baseline = {
      columns: ['id', 'name', 'createdAt', 'updatedBy'],
      rows: [[1, 'Alice', '2020-01-01', 'alice']],
    };
    const other = {
      columns: ['id', 'name', 'createdAt', 'updatedBy'],
      rows: [[1, 'Alice', '2024-06-01', 'bob']],
    };
    const withoutIgnore = compareResultGrids(baseline, other);
    expect(withoutIgnore.baseline.modified).toBe(2);

    const withIgnore = compareResultGrids(baseline, other, {
      ignoreColumns: ['createdAt', 'updatedBy'],
    });
    expect(withIgnore.totalDiffCells).toBe(0);
  });
});

