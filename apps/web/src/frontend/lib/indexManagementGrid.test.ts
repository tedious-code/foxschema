/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  averageFragmentation,
  formatIndexLastUsed,
  lastUsedSortValue,
  nextIndexMgmtSort,
  pickLatestIndexUsage,
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

describe('last used', () => {
  it('formats timestamps, never, and scan counts', () => {
    expect(formatIndexLastUsed({ lastUsed: '2024-06-15T12:00:00.000Z', scanCount: 9 })).toMatch(
      /2024/
    );
    expect(formatIndexLastUsed({ lastUsed: null, scanCount: 0 })).toBe('never');
    expect(formatIndexLastUsed({ lastUsed: null, scanCount: 12 })).toMatch(/12/);
    expect(formatIndexLastUsed({ lastUsed: null, scanCount: null })).toBe('—');
    expect(formatIndexLastUsed({ lastUsed: '0001-01-01', scanCount: 0 })).toBe('never');
  });

  it('sorts timestamps ahead of scan-only values', () => {
    const ts = '2024-01-02T00:00:00.000Z';
    expect(lastUsedSortValue(ts, 1)).toBe(Date.parse(ts));
    expect(lastUsedSortValue(null, 40)).toBe(40);
    expect(lastUsedSortValue(null, null)).toBeNull();
  });

  it('picks the most recent timestamp in a table group', () => {
    expect(
      pickLatestIndexUsage([
        { lastUsed: '2024-01-01T00:00:00.000Z', scanCount: 2 },
        { lastUsed: '2024-06-01T00:00:00.000Z', scanCount: 9 },
        { lastUsed: null, scanCount: 100 },
      ])
    ).toEqual({ lastUsed: '2024-06-01T00:00:00.000Z', scanCount: 100 });
  });

  it('sorts tables by last-used via tableSortValue', () => {
    const groups = [
      {
        tableName: 'OLD',
        indexCount: 1,
        avgFrag: null,
        rowCount: null,
        dataBytes: null,
        indexBytes: null,
        lastUsedMs: Date.parse('2020-01-01T00:00:00.000Z'),
        rows: [
          {
            indexName: 'ix_old',
            columns: 'a',
            type: 'unique',
            rowCount: null,
            dataBytes: null,
            indexBytes: null,
            fragPct: null,
            lastUsed: '2020-01-01T00:00:00.000Z',
            scanCount: 1,
          },
        ],
      },
      {
        tableName: 'NEW',
        indexCount: 1,
        avgFrag: null,
        rowCount: null,
        dataBytes: null,
        indexBytes: null,
        lastUsedMs: Date.parse('2024-01-01T00:00:00.000Z'),
        rows: [
          {
            indexName: 'ix_new',
            columns: 'a',
            type: 'unique',
            rowCount: null,
            dataBytes: null,
            indexBytes: null,
            fragPct: null,
            lastUsed: '2024-01-01T00:00:00.000Z',
            scanCount: 8,
          },
        ],
      },
    ];
    const sorted = sortGroupedIndexes(
      groups,
      { key: 'lastUsed', dir: 'desc' },
      (g) => tableSortValue('lastUsed', g),
      (r) => indexSortValue('lastUsed', r),
      (r) => r.indexName
    );
    expect(sorted.map((g) => g.tableName)).toEqual(['NEW', 'OLD']);
  });
});
