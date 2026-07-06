import { describe, it, expect } from 'vitest';
import {
  countByStatus,
  describeColumn,
  describeFk,
  describeIndex,
  describeTrigger,
  groupByType,
  sortSections,
} from '../diffPresentation';

describe('diffPresentation: describe* helpers', () => {
  it('describeColumn shows an old → new arrow when a MODIFIED column changed type', () => {
    const desc = describeColumn({
      name: 'AGE',
      status: 'MODIFIED',
      source: { type: 'int', nullable: true },
      target: { type: 'bigint', nullable: true },
    });
    expect(desc).toBe('int → bigint');
  });

  it('describeColumn shows just the type when a MODIFIED column kept its type (e.g. nullability changed)', () => {
    const desc = describeColumn({
      name: 'NAME',
      status: 'MODIFIED',
      source: { type: 'varchar(50)', nullable: true },
      target: { type: 'varchar(50)', nullable: false },
    });
    expect(desc).toBe('varchar(50) NOT NULL');
  });

  it('describeColumn falls back to the target type for an ADDED column', () => {
    expect(describeColumn({ name: 'NEW', status: 'ADDED', target: { type: 'text', nullable: true } })).toBe('text');
  });

  it('describeColumn falls back to the source type for a REMOVED column', () => {
    expect(describeColumn({ name: 'OLD', status: 'REMOVED', source: { type: 'text', nullable: true } })).toBe('text');
  });

  it('describeFk formats columns and the referenced table', () => {
    const desc = describeFk({
      name: 'FK_X',
      status: 'ADDED',
      target: { columns: ['warehouse_id'], referencedTable: 'warehouses', referencedColumns: ['id'] },
    });
    expect(desc).toBe('(warehouse_id) → warehouses(id)');
  });

  it('describeIndex marks unique indexes', () => {
    const desc = describeIndex({ name: 'UQ_X', status: 'MODIFIED', target: { columns: ['sku'], unique: true } });
    expect(desc).toBe('(sku) UNIQUE');
  });

  it('describeTrigger shows timing + event', () => {
    const desc = describeTrigger({
      name: 'TRG_X',
      status: 'ADDED',
      target: { name: 'trg_x', timing: 'AFTER', event: 'INSERT' },
    });
    expect(desc).toBe('AFTER INSERT');
  });
});

describe('diffPresentation: countByStatus', () => {
  it('counts items by status, omitting statuses with zero items', () => {
    const counts = countByStatus([
      { status: 'ADDED' },
      { status: 'ADDED' },
      { status: 'MODIFIED' },
      { status: 'UNCHANGED' },
    ]);
    expect(counts).toEqual({ ADDED: 2, MODIFIED: 1, UNCHANGED: 1 });
  });

  it('returns an empty object for an empty list', () => {
    expect(countByStatus([])).toEqual({});
  });
});

describe('diffPresentation: groupByType / sortSections', () => {
  it('groups by objectType and sorts sections by count descending', () => {
    const items = [
      { objectType: 'VIEW', tableName: 'V1', status: 'ADDED' },
      { objectType: 'TABLE', tableName: 'T1', status: 'ADDED' },
      { objectType: 'TABLE', tableName: 'T2', status: 'MODIFIED' },
    ];
    const sections = sortSections([...groupByType(items).entries()]);
    expect(sections.map(([type]) => type)).toEqual(['TABLE', 'VIEW']);
    expect(sections[0][1]).toHaveLength(2);
  });
});
