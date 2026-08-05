import { describe, it, expect } from 'vitest';
import { findDropDependencies } from './dependency-scan';
import type { TableDiff } from '../interfaces';

// Minimal TableDiff factory — only the fields the scanner reads.
function diff(partial: Partial<TableDiff> & Pick<TableDiff, 'tableName' | 'objectType' | 'status'>): TableDiff {
  return {
    columnDiffs: [],
    indexDiffs: [],
    foreignKeyDiffs: [],
    ...partial,
  } as TableDiff;
}

const view = (name: string, status: TableDiff['status'], def: string): TableDiff =>
  diff({ tableName: name, objectType: 'VIEW', status, targetTable: { name, objectType: 'VIEW', definition: def, columns: [], indices: [], foreignKeys: [] } });

describe('findDropDependencies', () => {
  it('flags a view that references a dropped table', () => {
    const tables = [
      diff({ tableName: 'ORDERS', objectType: 'TABLE', status: 'REMOVED' }),
      view('V_ORDER_SUMMARY', 'UNCHANGED', 'SELECT * FROM ORDERS'),
    ];
    const deps = findDropDependencies(tables, { ORDERS: true, V_ORDER_SUMMARY: false });
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ dependentName: 'V_ORDER_SUMMARY', kind: 'table', dropped: 'ORDERS', deployable: false });
  });

  it('flags a function that uses a dropped column (requires both table and column)', () => {
    const tables = [
      diff({
        tableName: 'ORDERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        columnDiffs: [{ name: 'USER_ID', status: 'REMOVED', target: { type: 'int', nullable: true } }],
      }),
      diff({
        tableName: 'FN_GET_DISCOUNT',
        objectType: 'FUNCTION',
        status: 'UNCHANGED',
        targetTable: { name: 'FN_GET_DISCOUNT', objectType: 'FUNCTION', definition: 'SELECT user_id FROM orders WHERE id = 1', columns: [], indices: [], foreignKeys: [] },
      }),
    ];
    const deps = findDropDependencies(tables, { ORDERS: true });
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ dependentName: 'FN_GET_DISCOUNT', kind: 'column', dropped: 'ORDERS.USER_ID' });
  });

  it('does not flag a column-name match when the table is not referenced (false-positive guard)', () => {
    const tables = [
      diff({
        tableName: 'ORDERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        columnDiffs: [{ name: 'STATUS', status: 'REMOVED', target: { type: 'int', nullable: true } }],
      }),
      // References a column called "status" but on a different table — must not flag.
      view('V_USERS', 'UNCHANGED', 'SELECT status FROM users'),
    ];
    expect(findDropDependencies(tables, { ORDERS: true })).toHaveLength(0);
  });

  it('returns nothing in non-destructive mode', () => {
    const tables = [
      diff({ tableName: 'ORDERS', objectType: 'TABLE', status: 'REMOVED' }),
      view('V_ORDER_SUMMARY', 'UNCHANGED', 'SELECT * FROM ORDERS'),
    ];
    expect(findDropDependencies(tables, { ORDERS: true }, { nonDestructive: true })).toHaveLength(0);
  });

  it('only considers selected drops', () => {
    const tables = [
      diff({ tableName: 'ORDERS', objectType: 'TABLE', status: 'REMOVED' }),
      view('V_ORDER_SUMMARY', 'UNCHANGED', 'SELECT * FROM ORDERS'),
    ];
    expect(findDropDependencies(tables, { ORDERS: false })).toHaveLength(0);
  });

  it('marks a MODIFIED dependent as deployable (can be recreated from source)', () => {
    const tables = [
      diff({ tableName: 'ORDERS', objectType: 'TABLE', status: 'REMOVED' }),
      view('V_ORDER_SUMMARY', 'MODIFIED', 'SELECT * FROM ORDERS'),
    ];
    const deps = findDropDependencies(tables, { ORDERS: true, V_ORDER_SUMMARY: false });
    expect(deps[0].deployable).toBe(true);
  });

  it('ignores schema qualifiers and casing when matching', () => {
    const tables = [
      diff({ tableName: 'APP.ORDERS', objectType: 'TABLE', status: 'REMOVED' }),
      view('V', 'UNCHANGED', 'select * from app.orders'),
    ];
    const deps = findDropDependencies(tables, { 'APP.ORDERS': true });
    expect(deps).toHaveLength(1);
    expect(deps[0].dropped).toBe('ORDERS');
  });

  it('does not warn about a dependent that is itself being dropped', () => {
    const tables = [
      diff({ tableName: 'ORDERS', objectType: 'TABLE', status: 'REMOVED' }),
      view('V_ORDER_SUMMARY', 'REMOVED', 'SELECT * FROM ORDERS'),
    ];
    expect(findDropDependencies(tables, { ORDERS: true, V_ORDER_SUMMARY: true })).toHaveLength(0);
  });
});
