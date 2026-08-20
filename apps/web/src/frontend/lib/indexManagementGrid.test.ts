/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  averageFragmentation,
  nextIndexMgmtSort,
  sortGroupedIndexes,
  tableSortValue,
  indexSortValue,
} from './indexManagementGrid';

describe('averageFragmentation', () => {
  it('returns null when no percents are known', () => {
    expect(averageFragmentation([null, undefined])).toBeNull();
    expect(averageFragmentation([])).toBeNull();
  });

  it('averages known percents and ignores missing', () => {
    expect(averageFragmentation([10, 30, null])).toBe(20);
  });
});

describe('nextIndexMgmtSort', () => {
  it('starts ascending on a new column and toggles the active one', () => {
    expect(nextIndexMgmtSort({ key: 'name', dir: 'asc' }, 'frag')).toEqual({
      key: 'frag',
      dir: 'asc',
    });
    expect(nextIndexMgmtSort({ key: 'frag', dir: 'asc' }, 'frag')).toEqual({
      key: 'frag',
      dir: 'desc',
    });
  });
});

describe('sortGroupedIndexes', () => {
  const groups = [
    {
      tableName: 'ORDERS',
      indexCount: 1,
      avgFrag: 40,
      rowCount: 10,
      dataBytes: 100,
      indexBytes: 20,
      rows: [{ indexName: 'PK_ORDERS', fragPct: 40, columns: 'ID', type: 'unique', rowCount: 10, dataBytes: null, indexBytes: 20 }],
    },
    {
      tableName: 'CUSTOMERS',
      indexCount: 2,
      avgFrag: 5,
      rowCount: 50,
      dataBytes: 400,
      indexBytes: 80,
      rows: [
        { indexName: 'IX_EMAIL', fragPct: 8, columns: 'EMAIL', type: 'unique', rowCount: 50, dataBytes: null, indexBytes: 50 },
        { indexName: 'PK_CUSTOMERS', fragPct: 2, columns: 'ID', type: 'unique', rowCount: 50, dataBytes: null, indexBytes: 30 },
      ],
    },
  ];

  it('sorts tables by average fragmentation and indexes inside the group', () => {
    const sorted = sortGroupedIndexes(
      groups,
      { key: 'frag', dir: 'desc' },
      (g) => tableSortValue('frag', g),
      (r) => indexSortValue('frag', r),
      (r) => r.indexName
    );
    expect(sorted.map((g) => g.tableName)).toEqual(['ORDERS', 'CUSTOMERS']);
    expect(sorted[1]?.rows.map((r) => r.indexName)).toEqual(['IX_EMAIL', 'PK_CUSTOMERS']);
  });

  it('sorts tables by index count', () => {
    const sorted = sortGroupedIndexes(
      groups,
      { key: 'indexes', dir: 'desc' },
      (g) => tableSortValue('indexes', g),
      (r) => indexSortValue('indexes', r),
      (r) => r.indexName
    );
    expect(sorted.map((g) => g.tableName)).toEqual(['CUSTOMERS', 'ORDERS']);
  });
});
