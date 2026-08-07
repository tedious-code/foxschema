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

