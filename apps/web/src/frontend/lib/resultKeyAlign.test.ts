/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { alignResultGridsByKey, compareKeyAlignedGrids } from './resultKeyAlign';
import { cellDiffKey } from './resultDataDiff';

describe('alignResultGridsByKey', () => {
  it('lines up matching keys and pads inserts/deletes', () => {
    const left = {
      columns: ['id', 'name'],
      rows: [
        [1, 'Alice'],
        [2, 'Shared'],
        [4, 'OnlyLeft'],
      ],
    };
    const right = {
      columns: ['id', 'name'],
      rows: [
        [2, 'Shared'],
        [1, 'Bob'],
        [3, 'OnlyRight'],
      ],
    };
    const aligned = alignResultGridsByKey(left, right, ['id']);
    expect(aligned).not.toBeNull();
    expect(aligned!.rowOps).toEqual(['update', 'match', 'delete', 'insert']);
    expect(aligned!.leftRows.map((r) => r[0])).toEqual([1, 2, 4, null]);
    expect(aligned!.rightRows.map((r) => r[0])).toEqual([1, 2, null, 3]);
    expect(aligned!.updateCount).toBe(1);
    expect(aligned!.matchCount).toBe(1);
    expect(aligned!.deleteCount).toBe(1);
    expect(aligned!.insertCount).toBe(1);
  });

  it('ignores trigger columns when deciding update vs match', () => {
    const left = {
      columns: ['id', 'name', 'updatedBy'],
      rows: [[1, 'Alice', 'a']],
    };
    const right = {
      columns: ['id', 'name', 'updatedBy'],
      rows: [[1, 'Alice', 'b']],
    };
    const aligned = alignResultGridsByKey(left, right, ['id'], {
      ignoreColumns: ['updatedBy'],
    });
    expect(aligned!.rowOps).toEqual(['match']);
  });

  it('returns null when a key column is missing', () => {
    const left = { columns: ['id'], rows: [[1]] };
    const right = { columns: ['name'], rows: [['x']] };
    expect(alignResultGridsByKey(left, right, ['id'])).toBeNull();
  });
});

describe('compareKeyAlignedGrids', () => {
  it('tints only differing cells on updates; full rows for insert/delete', () => {
    const left = {
      columns: ['id', 'name'],
      rows: [
        [1, 'Alice'],
        [2, 'Keep'],
      ],
    };
    const right = {
      columns: ['id', 'name'],
      rows: [
        [1, 'Bob'],
        [3, 'New'],
      ],
    };
    const aligned = alignResultGridsByKey(left, right, ['id'])!;
    const diff = compareKeyAlignedGrids(left, right, aligned);
    // update on row 0 (id=1): name modified
    expect(diff.baseline.cells.get(cellDiffKey(0, 1))).toBe('modified');
    expect(diff.other.cells.get(cellDiffKey(0, 1))).toBe('modified');
    // match id=2 then delete? left has 2, right doesn't → delete; right has 3 → insert
    const deleteIdx = aligned.rowOps.indexOf('delete');
    const insertIdx = aligned.rowOps.indexOf('insert');
    expect(diff.baseline.cells.get(cellDiffKey(deleteIdx, 0))).toBe('missing');
    expect(diff.other.cells.get(cellDiffKey(insertIdx, 0))).toBe('extra');
  });
});
