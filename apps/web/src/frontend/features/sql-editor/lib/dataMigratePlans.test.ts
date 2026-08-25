/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildDataMigratePlans,
  buildDestSnapshotJson,
  buildRestorePlansFromSnapshot,
  isUsableDataMigrateSnapshot,
  snapshotTargetConnectionId,
} from '@/features/sql-editor/lib/dataMigratePlans';
import type { ClassifiedRowDiff } from '@/features/sql-editor/lib/resultRowDiff';

const DEST_CONN = 'conn-dest-b';

function snapshotFor(ops: ClassifiedRowDiff[], cols = ['id', 'name']) {
  return buildDestSnapshotJson({
    tableName: 'customers',
    dialect: 'sqlite',
    connectionId: DEST_CONN,
    destColumns: cols,
    sourceColumns: cols,
    keyNames: ['id'],
    includeIdentity: true,
    ops,
  });
}

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

  it('snapshots dest rows for update/delete and source rows for insert', () => {
    const json = snapshotFor(ops);
    const parsed = JSON.parse(json) as {
      rows: Array<{ _op: string }>;
      includeIdentity: boolean;
      connectionId: string;
    };
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map((r) => r._op).sort()).toEqual(['delete', 'insert', 'update']);
    expect(parsed.includeIdentity).toBe(true);
    expect(parsed.connectionId).toBe(DEST_CONN);
  });

  it('omits identity columns from INSERT when includeIdentity is false', () => {
    const { plans, errors } = buildDataMigratePlans({
      tableName: 'customers',
      dialect: 'sqlite',
      sourceColumns: cols,
      destColumns: cols,
      keyNames: ['id'],
      ops: [{ op: 'insert', keyLabel: 'id=3', sourceRow: [3, 'New'] }],
      includeIdentity: false,
      identityColumns: new Set(['id']),
    });
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(1);
    const sql = plans[0]!.plan.sql.toLowerCase();
    expect(sql).toContain('insert');
    expect(sql).toContain('name');
    // Must not bind/preserve the source id when Include identity is off.
    expect(sql).not.toMatch(/\bid\b/);
    expect(plans[0]!.plan.params).toEqual(['New']);
  });

  it('omits ignored trigger columns from INSERT and UPDATE SQL', () => {
    const auditCols = ['id', 'name', 'createdAt', 'updatedBy'];
    const auditOps: ClassifiedRowDiff[] = [
      {
        op: 'insert',
        keyLabel: 'id=9',
        sourceRow: [9, 'New', '2020-01-01', 'src'],
      },
      {
        op: 'update',
        keyLabel: 'id=1',
        sourceRow: [1, 'Alice', '2020-01-01', 'src'],
        destRow: [1, 'Bob', '2024-01-01', 'dst'],
      },
    ];
    const { plans, errors } = buildDataMigratePlans({
      tableName: 'customers',
      dialect: 'sqlite',
      sourceColumns: auditCols,
      destColumns: auditCols,
      keyNames: ['id'],
      ops: auditOps,
      includeIdentity: true,
      identityColumns: new Set(['id']),
      ignoreColumns: ['createdAt', 'updatedBy'],
    });
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(2);
    const insertSql = plans[0]!.plan.sql.toLowerCase();
    const updateSql = plans[1]!.plan.sql.toLowerCase();
    expect(insertSql).not.toContain('createdat');
    expect(insertSql).not.toContain('updatedby');
    expect(updateSql).not.toContain('createdat');
    expect(updateSql).not.toContain('updatedby');
    expect(insertSql).toContain('name');
    expect(updateSql).toContain('name');
  });
});

describe('buildRestorePlansFromSnapshot', () => {
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

  it('reverses successful insert/update/delete from Backup', () => {
    const snapshotJson = snapshotFor(ops);
    const { plans, errors } = buildRestorePlansFromSnapshot({
      snapshotJson,
      successfulOps: [
        { op: 'insert', key: 'id=3' },
        { op: 'update', key: 'id=1' },
        { op: 'delete', key: 'id=4' },
      ],
    });
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(3);
    // Reverse order: delete→insert, update→update, insert→delete
    expect(plans.map((p) => p.op)).toEqual(['insert', 'update', 'delete']);
    expect(plans[0]!.plan.sql.toLowerCase()).toContain('insert');
    expect(plans[1]!.plan.sql.toLowerCase()).toContain('update');
    expect(plans[2]!.plan.sql.toLowerCase()).toContain('delete');
  });

  it('records the destination connection id for Restore binding', () => {
    const snapshotJson = snapshotFor(ops);
    expect(snapshotTargetConnectionId(snapshotJson)).toBe(DEST_CONN);
    expect(isUsableDataMigrateSnapshot(snapshotJson)).toBe(true);
  });

  it('rejects truncated / non-JSON History snapshots', () => {
    const bad = `${snapshotFor(ops).slice(0, 40)}\n… (truncated)`;
    expect(isUsableDataMigrateSnapshot(bad)).toBe(false);
    expect(snapshotTargetConnectionId(bad)).toBeUndefined();
  });

  it('skips insert restore when identity was not preserved', () => {
    const snapshotJson = buildDestSnapshotJson({
      tableName: 'customers',
      dialect: 'sqlite',
      connectionId: DEST_CONN,
      destColumns: cols,
      sourceColumns: cols,
      keyNames: ['id'],
      includeIdentity: false,
      ops: [{ op: 'insert', keyLabel: 'id=3', sourceRow: [3, 'New'] }],
    });
    const { plans, errors } = buildRestorePlansFromSnapshot({
      snapshotJson,
      successfulOps: [{ op: 'insert', key: 'id=3' }],
    });
    expect(plans).toHaveLength(0);
    expect(errors[0]).toMatch(/Include identity/i);
  });

  it('restores update to the pre-apply dest values', () => {
    const snapshotJson = snapshotFor([
      {
        op: 'update',
        keyLabel: 'id=1',
        sourceRow: [1, 'Alice'],
        destRow: [1, 'Bob'],
      },
    ]);
    const { plans, errors } = buildRestorePlansFromSnapshot({
      snapshotJson,
      successfulOps: [{ op: 'update', key: 'id=1' }],
    });
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.op).toBe('update');
    // SET name back to Bob (pre-migrate dest), WHERE id = 1
    expect(plans[0]!.plan.params).toContain('Bob');
    expect(plans[0]!.plan.params).toContain(1);
    expect(plans[0]!.plan.sql.toLowerCase()).toMatch(/update.*set.*name/s);
  });

  it('re-inserts a deleted dest row on restore', () => {
    const snapshotJson = snapshotFor([
      { op: 'delete', keyLabel: 'id=4', destRow: [4, 'Gone'] },
    ]);
    const { plans, errors } = buildRestorePlansFromSnapshot({
      snapshotJson,
      successfulOps: [{ op: 'delete', key: 'id=4' }],
    });
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.op).toBe('insert');
    expect(plans[0]!.plan.params).toEqual([4, 'Gone']);
  });

  it('ignores FAILED ops and reports missing snapshot rows', () => {
    const snapshotJson = snapshotFor([
      { op: 'delete', keyLabel: 'id=4', destRow: [4, 'Gone'] },
    ]);
    const { plans, errors } = buildRestorePlansFromSnapshot({
      snapshotJson,
      successfulOps: [
        { op: 'delete', key: 'id=4' },
        { op: 'update', key: 'id=missing' },
      ],
    });
    expect(plans).toHaveLength(1);
    expect(errors.some((e) => /no snapshot row/i.test(e))).toBe(true);
  });

  it('accepts legacy snapshots that only stored update/delete rows', () => {
    const legacy = JSON.stringify({
      columns: cols,
      rows: [{ _op: 'delete', _key: 'id=4', id: 4, name: 'Gone' }],
    });
    const { plans, errors } = buildRestorePlansFromSnapshot({
      snapshotJson: legacy,
      successfulOps: [{ op: 'delete', key: 'id=4' }],
      tableName: 'customers',
      dialect: 'sqlite',
    });
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.op).toBe('insert');
    expect(snapshotTargetConnectionId(legacy)).toBeUndefined();
  });
});

