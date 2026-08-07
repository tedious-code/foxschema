/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  allDiffKeyLabels,
  classifyRowsByKey,
  DATA_MIGRATE_ROW_CAP,
  filterOpsByKeyLabels,
  migrateGridsAreComplete,
  selectMigrateOps,
} from './resultRowDiff';

describe('classifyRowsByKey', () => {
  const cols = ['id', 'name', 'city'];

  it('classifies insert, update, and delete by key', () => {
    const source = {
      columns: cols,
      rows: [
        [1, 'Alice', 'Denver'],
        [2, 'Shared', 'Austin'],
        [3, 'New', 'Boston'],
      ],
    };
    const dest = {
      columns: cols,
      rows: [
        [1, 'Bob', 'Denver'],
        [2, 'Shared', 'Austin'],
        [4, 'OnlyDest', 'X'],
      ],
    };
    const c = classifyRowsByKey({ source, dest, keyNames: ['id'] });
    expect(c.inserts).toHaveLength(1);
    expect(c.inserts[0]!.keyLabel).toMatch(/id=3/);
    expect(c.updates).toHaveLength(1);
    expect(c.updates[0]!.keyLabel).toMatch(/id=1/);
    expect(c.deletes).toHaveLength(1);
    expect(c.deletes[0]!.keyLabel).toMatch(/id=4/);
    expect(c.totalOps).toBe(3);
  });

  it('skips null keys', () => {
    const source = { columns: cols, rows: [[null, 'a', 'b']] };
    const dest = { columns: cols, rows: [] };
    const c = classifyRowsByKey({ source, dest, keyNames: ['id'] });
    expect(c.inserts).toHaveLength(0);
    expect(c.skippedNullKeys).toBe(1);
  });

  it('matches composite keys', () => {
    const source = {
      columns: ['a', 'b', 'v'],
      rows: [
        [1, 'x', 10],
        [1, 'y', 20],
      ],
    };
    const dest = {
      columns: ['a', 'b', 'v'],
      rows: [[1, 'x', 11]],
    };
    const c = classifyRowsByKey({ source, dest, keyNames: ['a', 'b'] });
    expect(c.updates).toHaveLength(1);
    expect(c.inserts).toHaveLength(1);
    expect(c.deletes).toHaveLength(0);
  });

  it('does not collide when key values contain delimiter characters', () => {
    const source = {
      columns: ['a', 'b', 'v'],
      rows: [['foo|b=bar', 'baz', 1]],
    };
    const dest = {
      columns: ['a', 'b', 'v'],
      rows: [['foo', 'bar|b=baz', 2]],
    };
    const c = classifyRowsByKey({ source, dest, keyNames: ['a', 'b'] });
    expect(c.updates).toHaveLength(0);
    expect(c.inserts).toHaveLength(1);
    expect(c.deletes).toHaveLength(1);
  });

  it('counts duplicate keys instead of silently keeping the first row', () => {
    const source = {
      columns: ['id', 'name'],
      rows: [
        [1, 'first'],
        [1, 'second'],
      ],
    };
    const dest = { columns: ['id', 'name'], rows: [[1, 'dest']] };
    const c = classifyRowsByKey({ source, dest, keyNames: ['id'] });
    expect(c.duplicateKeys).toBe(1);
    expect(c.updates).toHaveLength(1);
    expect(c.updates[0]!.sourceRow).toEqual([1, 'first']);
  });

  it('does not treat differing trigger columns as updates when ignored', () => {
    const columns = ['id', 'name', 'createdAt', 'updatedBy'];
    const source = {
      columns,
      rows: [[1, 'Alice', '2020-01-01', 'src-user']],
    };
    const dest = {
      columns,
      rows: [[1, 'Alice', '2024-06-01', 'dest-user']],
    };
    const without = classifyRowsByKey({ source, dest, keyNames: ['id'] });
    expect(without.updates).toHaveLength(1);

    const withIgnore = classifyRowsByKey({
      source,
      dest,
      keyNames: ['id'],
      ignoreColumns: ['createdAt', 'updatedBy'],
    });
    expect(withIgnore.updates).toHaveLength(0);
    expect(withIgnore.totalOps).toBe(0);
  });
});


describe('migrateGridsAreComplete', () => {
  it('requires page 1 with no remaining pages on both sides', () => {
    expect(
      migrateGridsAreComplete({
        sourcePageIndex: 0,
        destPageIndex: 0,
        sourceHasMore: false,
        destHasMore: false,
      })
    ).toBe(true);
    // Dest on page 2 while source stays on page 1 → Delete would drop dest keys
    // that still exist later in the source.
    expect(
      migrateGridsAreComplete({
        sourcePageIndex: 0,
        destPageIndex: 1,
        sourceHasMore: false,
        destHasMore: false,
      })
    ).toBe(false);
    expect(
      migrateGridsAreComplete({
        sourcePageIndex: 0,
        destPageIndex: 0,
        sourceHasMore: true,
        destHasMore: false,
      })
    ).toBe(false);
  });
});

describe('selectMigrateOps', () => {
  it('respects checkboxes and caps at 500', () => {
    const inserts = Array.from({ length: 300 }, (_, i) => ({
      op: 'insert' as const,
      keyLabel: `id=${i}`,
      sourceRow: [i],
    }));
    const updates = Array.from({ length: 300 }, (_, i) => ({
      op: 'update' as const,
      keyLabel: `id=${i + 1000}`,
      sourceRow: [i],
      destRow: [i],
    }));
    const classification = {
      inserts,
      updates,
      deletes: [],
      skippedNullKeys: 0,
      duplicateKeys: 0,
      totalOps: 600,
    };
    const selected = selectMigrateOps(
      classification,
      { insert: true, update: true, delete: false },
      DATA_MIGRATE_ROW_CAP
    );
    expect(selected.uncappedCount).toBe(600);
    expect(selected.truncated).toBe(true);
    expect(selected.ops).toHaveLength(DATA_MIGRATE_ROW_CAP);
    expect(selected.ops.every((o) => o.op === 'insert' || o.op === 'update')).toBe(
      true
    );
  });
});

describe('filterOpsByKeyLabels / allDiffKeyLabels', () => {
  const classification = classifyRowsByKey({
    source: {
      columns: ['id', 'name'],
      rows: [
        [1, 'Alice'],
        [2, 'Shared'],
        [3, 'New'],
      ],
    },
    dest: {
      columns: ['id', 'name'],
      rows: [
        [1, 'Bob'],
        [2, 'Shared'],
        [4, 'OnlyDest'],
      ],
    },
    keyNames: ['id'],
  });

  it('lists every differing key label', () => {
    expect(allDiffKeyLabels(classification)).toHaveLength(3);
  });

  it('defaults to all selected; uncheck drops from migrate plans', () => {
    const byOp = selectMigrateOps(classification, {
      insert: true,
      update: true,
      delete: true,
    });
    expect(filterOpsByKeyLabels(byOp.ops, new Set(allDiffKeyLabels(classification))).uncappedCount).toBe(3);
    const updateLabel = classification.updates[0]!.keyLabel;
    const without = filterOpsByKeyLabels(
      byOp.ops,
      new Set(allDiffKeyLabels(classification).filter((l) => l !== updateLabel))
    );
    expect(without.uncappedCount).toBe(2);
  });

  it('Sync all restores every differing label', () => {
    const byOp = selectMigrateOps(classification, {
      insert: true,
      update: true,
      delete: true,
    });
    expect(filterOpsByKeyLabels(byOp.ops, new Set()).uncappedCount).toBe(0);
    expect(
      filterOpsByKeyLabels(byOp.ops, new Set(allDiffKeyLabels(classification))).uncappedCount
    ).toBe(3);
  });
});
