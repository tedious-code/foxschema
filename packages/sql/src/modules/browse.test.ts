import { describe, it, expect } from 'vitest';
import { buildBrowseResult } from './browse';
import type { TableSchema } from '../interfaces';

const table = (over: Partial<TableSchema> & Pick<TableSchema, 'name' | 'objectType'>): TableSchema => ({
  columns: [],
  indices: [],
  foreignKeys: [],
  ...over,
});

describe('buildBrowseResult', () => {
  it('maps each object to an UNCHANGED TableDiff sorted by name', () => {
    const tables = [
      table({ name: 'ORDERS', objectType: 'TABLE', columns: [{ name: 'ID', type: 'int', nullable: false, primaryKey: true }] }),
      table({ name: 'CUSTOMERS', objectType: 'TABLE' }),
    ];
    const result = buildBrowseResult(tables, 'source');
    expect(result.tables.map((t) => t.tableName)).toEqual(['CUSTOMERS', 'ORDERS']);
    expect(result.tables.every((t) => t.status === 'UNCHANGED')).toBe(true);
    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 2 });
  });

  it('puts object data on the source slot for side=source', () => {
    const tables = [table({ name: 'ORDERS', objectType: 'TABLE', columns: [{ name: 'ID', type: 'int', nullable: false, primaryKey: true }] })];
    const [diff] = buildBrowseResult(tables, 'source').tables;
    expect(diff.sourceTable?.name).toBe('ORDERS');
    expect(diff.targetTable).toBeUndefined();
    expect(diff.columnDiffs[0]).toMatchObject({ name: 'ID', status: 'UNCHANGED', source: { type: 'int' } });
  });

  it('puts object data on the target slot for side=target', () => {
    const tables = [table({ name: 'V', objectType: 'VIEW', definition: 'SELECT 1' })];
    const [diff] = buildBrowseResult(tables, 'target').tables;
    expect(diff.targetTable?.name).toBe('V');
    expect(diff.sourceTable).toBeUndefined();
    expect(diff.definition).toBe('SELECT 1');
  });

  it('carries indexes, foreign keys and triggers into searchable diff arrays', () => {
    const tables = [
      table({
        name: 'ORDERS',
        objectType: 'TABLE',
        indices: [{ name: 'IDX_ORDERS_USER', columns: ['USER_ID'], unique: false }],
        foreignKeys: [{ name: 'FK_USER', columns: ['USER_ID'], referencedTable: 'USERS', referencedColumns: ['ID'] }],
        triggers: [{ name: 'TRG_AUDIT', definition: 'BEGIN END' }],
      }),
    ];
    const [diff] = buildBrowseResult(tables, 'source').tables;
    expect(diff.indexDiffs[0]).toMatchObject({ name: 'IDX_ORDERS_USER', status: 'UNCHANGED' });
    expect(diff.foreignKeyDiffs[0]).toMatchObject({ name: 'FK_USER', status: 'UNCHANGED' });
    expect(diff.triggerDiffs?.[0]).toMatchObject({ name: 'TRG_AUDIT', status: 'UNCHANGED' });
  });
});
