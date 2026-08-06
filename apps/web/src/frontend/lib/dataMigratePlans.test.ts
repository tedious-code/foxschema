/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildDataMigratePlans, buildDestSnapshotJson } from './dataMigratePlans';
import type { ClassifiedRowDiff } from './resultRowDiff';

describe('buildDataMigratePlans', () => {
  const cols = ['id', 'name'];
  const ops: ClassifiedRowDiff[] = [
    { op: 'insert', keyLabel: 'id=3', sourceRow: [3, 'New'] },
    {
      op: 'update',
      keyLabel: 'id=1',
      sourceRow: [1, 'Alice'],
      destRow: [1, 'Bob'],
    },
    { op: 'delete', keyLabel: 'id=4', destRow: [4, 'Gone'] },
  ];

  it('builds insert/update/delete plans for sqlite', () => {
    const { plans, errors } = buildDataMigratePlans({
      tableName: 'customers',
      dialect: 'sqlite',
      sourceColumns: cols,
      destColumns: cols,
      keyNames: ['id'],
      ops,
      includeIdentity: true,
      identityColumns: new Set(['id']),
    });
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(3);
    expect(plans[0]!.plan.kind).toBe('insert');
    expect(plans[0]!.plan.sql.toLowerCase()).toContain('insert into');
    expect(plans[1]!.plan.kind).toBe('update');
    expect(plans[1]!.plan.sql.toLowerCase()).toContain('update');
    expect(plans[2]!.plan.kind).toBe('delete');
    expect(plans[2]!.plan.sql.toLowerCase()).toContain('delete from');
  });

  it('snapshots dest rows for update/delete', () => {
    const json = buildDestSnapshotJson({ destColumns: cols, ops });
    const parsed = JSON.parse(json) as { rows: unknown[] };
    expect(parsed.rows).toHaveLength(2);
  });
});
