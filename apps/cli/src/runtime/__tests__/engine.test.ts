import { describe, it, expect } from 'vitest';
import type { TableDiff } from '@foxschema/core';
import { filterIndexDiffs } from '../engine';

function tableWithIndexes(indexDiffs: TableDiff['indexDiffs']): TableDiff {
  return {
    tableName: 'ORDERS',
    status: 'MODIFIED',
    objectType: 'table',
    columnDiffs: [],
    indexDiffs,
    fkDiffs: [],
  } as unknown as TableDiff;
}

describe('filterIndexDiffs', () => {
  const changed = [
    { name: 'idx_added', status: 'ADDED' },
    { name: 'idx_removed', status: 'REMOVED' },
    { name: 'idx_modified', status: 'MODIFIED' },
    { name: 'idx_same', status: 'UNCHANGED' },
  ] as TableDiff['indexDiffs'];

  it('strips ADDED/REMOVED/MODIFIED index diffs by default (includeIndexes: false)', () => {
    const [result] = filterIndexDiffs([tableWithIndexes(changed)], false);
    expect(result.indexDiffs.map((i) => i.name)).toEqual(['idx_same']);
  });

  it('keeps every index diff when includeIndexes is true', () => {
    const [result] = filterIndexDiffs([tableWithIndexes(changed)], true);
    expect(result.indexDiffs).toEqual(changed);
  });

  it('leaves tables with no index diffs untouched', () => {
    const [result] = filterIndexDiffs([tableWithIndexes([])], false);
    expect(result.indexDiffs).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const original = tableWithIndexes(changed);
    filterIndexDiffs([original], false);
    expect(original.indexDiffs).toEqual(changed);
  });
});
