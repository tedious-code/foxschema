/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  assessPeekEditability,
  buildPeekDelete,
  buildPeekInsert,
  buildPeekUpdate,
  draftToArray,
  resolvePeekKeyColumns,
} from './rowDml';
import type { TableSchema } from './types';

const usersTable: TableSchema = {
  name: 'public.users',
  objectType: 'TABLE',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true, identity: true },
    { name: 'email', type: 'text', nullable: false, primaryKey: false },
    { name: 'name', type: 'text', nullable: true, primaryKey: false },
  ],
  indices: [],
  foreignKeys: [],
  primaryKey: { columns: ['id'] },
};

describe('rowDml', () => {
  it('assesses editability from PK + result columns', () => {
    const ok = assessPeekEditability({
      dialect: 'postgres',
      table: usersTable,
      resultColumns: ['id', 'email', 'name'],
    });
    expect(ok.editable).toBe(true);
    expect(ok.keyColumns.map((k) => k.name)).toEqual(['id']);

    expect(
      assessPeekEditability({
        dialect: 'clickhouse',
        table: usersTable,
        resultColumns: ['id', 'email'],
      }).editable
    ).toBe(false);

    expect(
      assessPeekEditability({
        dialect: 'postgres',
        table: { ...usersTable, objectType: 'VIEW', primaryKey: undefined, columns: usersTable.columns.map((c) => ({ ...c, primaryKey: false })) },
        resultColumns: ['id', 'email'],
      }).editable
    ).toBe(false);
  });

  it('builds UPDATE with bound params', () => {
    const keys = resolvePeekKeyColumns(usersTable, ['id', 'email', 'name']);
    const plan = buildPeekUpdate({
      tableName: 'public.users',
      dialect: 'postgres',
      columns: ['id', 'email', 'name'],
      originalRow: [1, 'a@x.com', 'Ada'],
      draftRow: [1, 'a@x.com', 'Ada Lovelace'],
      keyColumns: keys,
    });
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.kind).toBe('update');
    expect(plan.sql).toMatch(/UPDATE/i);
    expect(plan.sql).toMatch(/"name"\s*=\s*\$1/i);
    expect(plan.sql).toMatch(/"id"\s*=\s*\$2/i);
    expect(plan.params).toEqual(['Ada Lovelace', 1]);
  });

  it('builds INSERT and DELETE', () => {
    const insert = buildPeekInsert({
      tableName: 'public.users',
      dialect: 'postgres',
      values: { email: 'b@x.com', name: 'Bob' },
      identityColumns: new Set(['id']),
    });
    expect('error' in insert).toBe(false);
    if ('error' in insert) return;
    expect(insert.sql).toMatch(/INSERT INTO/i);
    expect(insert.params).toEqual(['b@x.com', 'Bob']);

    const keys = resolvePeekKeyColumns(usersTable, ['id', 'email', 'name']);
    const del = buildPeekDelete({
      tableName: 'public.users',
      dialect: 'postgres',
      columns: ['id', 'email', 'name'],
      row: [7, 'c@x.com', 'Cy'],
      keyColumns: keys,
    });
    expect('error' in del).toBe(false);
    if ('error' in del) return;
    expect(del.sql).toMatch(/DELETE FROM/i);
    expect(del.params).toEqual([7]);
  });

  it('draftToArray preserves numeric types from original', () => {
    expect(draftToArray(['id', 'email'], { id: '3', email: 'x' }, [1, 'a'])).toEqual([3, 'x']);
  });
});
