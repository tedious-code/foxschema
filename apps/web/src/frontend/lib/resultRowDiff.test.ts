/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  classifyRowsByKey,
  DATA_MIGRATE_ROW_CAP,
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
