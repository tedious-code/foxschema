/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Leaving a column out of a migration is safe right up until something else in
 * the same script names it. These tests are mostly about that boundary: a
 * script that drops a column but keeps the index on it fails partway through,
 * with the schema in neither the old shape nor the new one.
 */
import { describe, expect, it } from 'vitest';
import {
  applyColumnSelection,
  applySelectionToDiff,
  applyTriggerSelection,
  blockedColumns,
  columnExclusionBlock,
  supportsColumnSelection,
} from './column-selection';
import type { TableDiff } from '../../interfaces/diff.types.interface.js';

const col = (
  name: string,
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED',
  extra: Record<string, unknown> = {}
) =>
  ({
    name,
    status,
    source: { name, type: 'text', nullable: true, ...extra },
  }) as TableDiff['columnDiffs'][number];

function table(over: Partial<TableDiff> = {}): TableDiff {
  return {
    tableName: 'ORDERS',
    status: 'MODIFIED',
    objectType: 'TABLE',
    columnDiffs: [],
    indexDiffs: [],
    foreignKeyDiffs: [],
    triggerDiffs: [],
    ...over,
  } as TableDiff;
}

describe('which columns may be left out', () => {
  it('allows an ordinary added column', () => {
    const t = table({ columnDiffs: [col('NOTE', 'ADDED')] });
    expect(columnExclusionBlock(t, 'NOTE')).toBeNull();
  });

  it('refuses a primary key column', () => {
    // A CREATE TABLE cannot omit a column its key names.
    const t = table({ columnDiffs: [col('ID', 'ADDED', { primaryKey: true })] });
    expect(columnExclusionBlock(t, 'ID')?.reason).toMatch(/primary key/i);
  });

  it('refuses a column an emitted index names', () => {
    const t = table({
      columnDiffs: [col('EMAIL', 'ADDED')],
      indexDiffs: [
        {
          name: 'IDX_EMAIL',
          status: 'ADDED',
          source: { name: 'idx_email', columns: ['email'], unique: true },
        },
      ],
    });
    expect(columnExclusionBlock(t, 'EMAIL')?.reason).toMatch(/idx_email/);
  });

  it('matches index columns case-insensitively', () => {
    // Compare keys are uppercased; catalog column lists are not. Matching raw
    // silently succeeds on Oracle and silently fails everywhere else.
    const t = table({
      columnDiffs: [col('EMAIL', 'ADDED')],
      indexDiffs: [
        { name: 'IDX', status: 'ADDED', source: { name: 'idx', columns: ['Email'], unique: false } },
      ],
    });
    expect(columnExclusionBlock(t, 'EMAIL')).not.toBeNull();
  });

  it('refuses a column a foreign key names', () => {
    const t = table({
      columnDiffs: [col('CUSTOMER_ID', 'ADDED')],
      foreignKeyDiffs: [
        {
          name: 'FK_CUST',
          status: 'ADDED',
          source: { columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] },
        },
      ],
    });
    expect(columnExclusionBlock(t, 'CUSTOMER_ID')?.reason).toMatch(/foreign key/i);
  });

  it('ignores an index that is not part of the migration', () => {
    const t = table({
      columnDiffs: [col('EMAIL', 'ADDED')],
      indexDiffs: [
        { name: 'IDX', status: 'UNCHANGED', source: { name: 'idx', columns: ['email'], unique: false } },
      ],
    });
    expect(columnExclusionBlock(t, 'EMAIL')).toBeNull();
  });

  it('ignores an index the reader never opted into', () => {
    // Indexes are opt-in. One that was not ticked emits nothing, so removing a
    // column cannot break it.
    const t = table({
      columnDiffs: [col('EMAIL', 'ADDED')],
      indexDiffs: [
        { name: 'IDX', status: 'ADDED', source: { name: 'idx', columns: ['email'], unique: false } },
      ],
    });
    expect(columnExclusionBlock(t, 'EMAIL', { includedIndexes: new Set(['OTHER']) })).toBeNull();
    expect(columnExclusionBlock(t, 'EMAIL', { includedIndexes: new Set(['IDX']) })).not.toBeNull();
    // An empty set is "opted into none", not "unknown": nothing blocks.
    expect(columnExclusionBlock(t, 'EMAIL', { includedIndexes: new Set() })).toBeNull();
    // Omitting it is "unknown", so every emitted index still counts.
    expect(columnExclusionBlock(t, 'EMAIL')).not.toBeNull();
  });

  it('allows removed and modified columns even when indexed', () => {
    // Excluding a drop keeps the column; excluding a type change leaves it as
    // it was. Either way the index still has something to name.
    const t = table({
      columnDiffs: [col('EMAIL', 'REMOVED'), col('NAME', 'MODIFIED')],
      indexDiffs: [
        {
          name: 'IDX',
          status: 'ADDED',
          source: { name: 'idx', columns: ['email', 'name'], unique: false },
        },
      ],
    });
    expect(columnExclusionBlock(t, 'EMAIL')).toBeNull();
    expect(columnExclusionBlock(t, 'NAME')).toBeNull();
  });

  it('lists every blocked column at once', () => {
    const t = table({
      columnDiffs: [col('ID', 'ADDED', { primaryKey: true }), col('NOTE', 'ADDED')],
    });
    const blocked = blockedColumns(t);
    expect([...blocked.keys()]).toEqual(['ID']);
  });
});

describe('applying a column selection', () => {
  const t = table({
    columnDiffs: [col('ID', 'ADDED', { primaryKey: true }), col('NOTE', 'ADDED'), col('OLD', 'UNCHANGED')],
  });

  it('is a no-op when nothing was chosen', () => {
    expect(applyColumnSelection(t, undefined)).toHaveLength(3);
  });

  it('keeps everything not explicitly excluded', () => {
    // Opt-out: an absent entry means migrate, so an untouched table behaves
    // exactly as it did before this feature existed.
    expect(applyColumnSelection(t, {})).toHaveLength(3);
    expect(applyColumnSelection(t, { NOTE: true })).toHaveLength(3);
  });

  it('drops a column set to false', () => {
    const out = applyColumnSelection(t, { NOTE: false });
    expect(out.map((c) => c.name)).toEqual(['ID', 'OLD']);
  });

  it('keeps a blocked column however it was ticked', () => {
    // The selection is a request; this is the last place that can refuse an
    // invalid script.
    const out = applyColumnSelection(t, { ID: false, NOTE: false });
    expect(out.map((c) => c.name)).toContain('ID');
    expect(out.map((c) => c.name)).not.toContain('NOTE');
  });

  it('never drops an unchanged column', () => {
    // They carry no statement, and CREATE TABLE still needs to see them.
    const out = applyColumnSelection(t, { OLD: false });
    expect(out.map((c) => c.name)).toContain('OLD');
  });
});

describe('applying a trigger selection', () => {
  const t = table({
    triggerDiffs: [
      { name: 'TRG_A', status: 'ADDED' },
      { name: 'TRG_B', status: 'MODIFIED' },
      { name: 'TRG_C', status: 'UNCHANGED' },
    ],
  } as Partial<TableDiff>);

  it('keeps everything by default', () => {
    expect(applyTriggerSelection(t, undefined)).toHaveLength(3);
    expect(applyTriggerSelection(t, {})).toHaveLength(3);
  });

  it('drops a trigger set to false', () => {
    const out = applyTriggerSelection(t, { TRG_A: false });
    expect(out.map((x) => x.name)).toEqual(['TRG_B', 'TRG_C']);
  });

  it('never drops an unchanged trigger', () => {
    const out = applyTriggerSelection(t, { TRG_C: false });
    expect(out.map((x) => x.name)).toContain('TRG_C');
  });

  it('copes with a table that has no triggers', () => {
    expect(applyTriggerSelection(table(), { X: false })).toEqual([]);
  });
});

describe('a foreign key on another table', () => {
  // The key sits on the child and names columns on the parent, so the parent's
  // own diff says nothing about it. Dropping the parent column left the child's
  // ADD CONSTRAINT naming a column the script never created — and that runs
  // after the table already exists.
  const parent = table({ tableName: 'CUSTOMERS', columnDiffs: [col('ID', 'ADDED')] });
  const child = table({
    tableName: 'ORDERS',
    foreignKeyDiffs: [
      {
        name: 'FK_ORDERS_CUSTOMER',
        status: 'ADDED',
        source: { columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] },
      },
    ],
  } as Partial<TableDiff>);

  it('pins the column it references', () => {
    const block = columnExclusionBlock(parent, 'ID', { siblings: [parent, child] });
    expect(block?.reason).toMatch(/ORDERS/);
    expect(block?.reason).toMatch(/FK_ORDERS_CUSTOMER/);
  });

  it('does not pin when the caller gives no wider view', () => {
    expect(columnExclusionBlock(parent, 'ID')).toBeNull();
  });

  it('ignores a key that is not part of the migration', () => {
    const unchanged = {
      ...child,
      foreignKeyDiffs: [{ ...child.foreignKeyDiffs![0]!, status: 'UNCHANGED' as const }],
    };
    expect(columnExclusionBlock(parent, 'ID', { siblings: [parent, unchanged] })).toBeNull();
  });

  it('matches a schema-qualified reference, case-folded', () => {
    const qualified = {
      ...child,
      foreignKeyDiffs: [
        {
          ...child.foreignKeyDiffs![0]!,
          source: { columns: ['customer_id'], referencedTable: 'Sales.Customers', referencedColumns: ['Id'] },
        },
      ],
    };
    expect(columnExclusionBlock(parent, 'ID', { siblings: [parent, qualified] })).not.toBeNull();
  });
});

describe('a self-referencing foreign key', () => {
  // Local columns pin via columnsOf; referencedColumns are on the same table
  // and were previously invisible — siblings skip self, so CODE looked free
  // to exclude while ADD CONSTRAINT still named it.
  const emp = table({
    tableName: 'EMPLOYEES',
    columnDiffs: [col('CODE', 'ADDED'), col('MANAGER_CODE', 'ADDED')],
    foreignKeyDiffs: [
      {
        name: 'FK_MGR',
        status: 'ADDED',
        source: {
          columns: ['manager_code'],
          referencedTable: 'employees',
          referencedColumns: ['code'],
        },
      },
    ],
  });

  it('pins the referenced parent column on the same table', () => {
    expect(columnExclusionBlock(emp, 'CODE')?.reason).toMatch(/FK_MGR/);
    expect(columnExclusionBlock(emp, 'CODE')?.reason).toMatch(/Referenced/i);
  });

  it('still pins the local child column', () => {
    expect(columnExclusionBlock(emp, 'MANAGER_CODE')?.reason).toMatch(/foreign key/i);
  });

  it('keeps a selected-out referenced column in the diff', () => {
    const out = applySelectionToDiff(emp, { columnSelection: { CODE: false } });
    expect(out.columnDiffs.map((c) => c.name)).toContain('CODE');
  });

  it('matches a schema-qualified self-reference, case-folded', () => {
    const qualified = table({
      tableName: 'EMPLOYEES',
      columnDiffs: [col('CODE', 'ADDED')],
      foreignKeyDiffs: [
        {
          name: 'FK_MGR',
          status: 'ADDED',
          source: {
            columns: ['manager_code'],
            referencedTable: 'Hr.Employees',
            referencedColumns: ['Code'],
          },
        },
      ],
    });
    expect(columnExclusionBlock(qualified, 'CODE')).not.toBeNull();
  });
});

describe('applySelectionToDiff', () => {
  const modified = table({
    tableName: 'ORDERS',
    status: 'MODIFIED',
    columnDiffs: [col('ID', 'ADDED', { primaryKey: true }), col('NOTE', 'ADDED')],
    triggerDiffs: [{ name: 'TRG', status: 'ADDED' }],
  } as Partial<TableDiff>);

  it('drops the column from the diff list', () => {
    const out = applySelectionToDiff(modified, { columnSelection: { NOTE: false } });
    expect(out.columnDiffs.map((c) => c.name)).toEqual(['ID']);
  });

  it('keeps a blocked column', () => {
    const out = applySelectionToDiff(modified, { columnSelection: { ID: false } });
    expect(out.columnDiffs.map((c) => c.name)).toContain('ID');
  });

  it('applies the trigger opt-out too', () => {
    const out = applySelectionToDiff(modified, { triggerSelection: { TRG: false } });
    expect(out.triggerDiffs).toEqual([]);
  });

  it('changes nothing when nothing was chosen', () => {
    const out = applySelectionToDiff(modified, {});
    expect(out.columnDiffs).toHaveLength(2);
    expect(out.triggerDiffs).toHaveLength(1);
  });
});

describe('a foreign key on another table', () => {
  // The key sits on the child and names columns on the parent, so the parent's
  // own diff says nothing about it. Dropping the parent column left the child's
  // ADD CONSTRAINT naming a column the script never created — and that runs
  // after the table already exists.
  const parent = table({ tableName: 'CUSTOMERS', columnDiffs: [col('ID', 'ADDED')] });
  const child = table({
    tableName: 'ORDERS',
    foreignKeyDiffs: [
      {
        name: 'FK_ORDERS_CUSTOMER',
        status: 'ADDED',
        source: { columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] },
      },
    ],
  } as Partial<TableDiff>);

  it('pins the column it references', () => {
    const block = columnExclusionBlock(parent, 'ID', { siblings: [parent, child] });
    expect(block?.reason).toMatch(/ORDERS/);
    expect(block?.reason).toMatch(/FK_ORDERS_CUSTOMER/);
  });

  it('does not pin when the caller gives no wider view', () => {
    expect(columnExclusionBlock(parent, 'ID')).toBeNull();
  });

  it('ignores a key that is not part of the migration', () => {
    const unchanged = {
      ...child,
      foreignKeyDiffs: [{ ...child.foreignKeyDiffs![0]!, status: 'UNCHANGED' as const }],
    };
    expect(columnExclusionBlock(parent, 'ID', { siblings: [parent, unchanged] })).toBeNull();
  });

  it('matches a schema-qualified reference, case-folded', () => {
    const qualified = {
      ...child,
      foreignKeyDiffs: [
        {
          ...child.foreignKeyDiffs![0]!,
          source: { columns: ['customer_id'], referencedTable: 'Sales.Customers', referencedColumns: ['Id'] },
        },
      ],
    };
    expect(columnExclusionBlock(parent, 'ID', { siblings: [parent, qualified] })).not.toBeNull();
  });
});

describe('objects that do not migrate column by column', () => {
  // The whole class of edge case this module accumulated lived in trying to
  // make a checkbox work where the migration emits one statement for the whole
  // object. It is not offered there any more.
  const created = {
    ...table({ tableName: 'ORDERS', status: 'ADDED', columnDiffs: [col('A', 'ADDED')] }),
    sourceTable: {
      name: 'orders',
      columns: [{ name: 'a', type: 'text', nullable: true }],
      indices: [{ name: 'idx_a', columns: ['a'], unique: false }],
      foreignKeys: [],
    },
  } as unknown as TableDiff;

  it('says so for a table being created', () => {
    expect(supportsColumnSelection(created)).toBe(false);
  });

  it('says so for a view or routine, which come from a stored definition', () => {
    for (const objectType of ['VIEW', 'MQT', 'FUNCTION', 'PROCEDURE'] as const) {
      const obj = table({ objectType, status: 'MODIFIED' } as Partial<TableDiff>);
      expect(supportsColumnSelection(obj), objectType).toBe(false);
    }
  });

  it('says so for a table being dropped', () => {
    // A DROP TABLE names no columns, so unticking one filtered the diffs while
    // the plan dropped the table anyway. `!== ADDED` was the same mistake as
    // the created case, in smaller print.
    expect(supportsColumnSelection(table({ status: 'REMOVED' }))).toBe(false);
  });

  it('ignores opt-outs on a dropped table', () => {
    const removed = table({
      status: 'REMOVED',
      columnDiffs: [col('A', 'REMOVED')],
      triggerDiffs: [{ name: 'TRG', status: 'REMOVED' }],
    } as Partial<TableDiff>);
    const out = applySelectionToDiff(removed, {
      columnSelection: { A: false },
      triggerSelection: { TRG: false },
    });
    expect(out.columnDiffs).toHaveLength(1);
    expect(out.triggerDiffs).toHaveLength(1);
  });

  it('says yes only for a table being altered', () => {
    expect(supportsColumnSelection(table({ status: 'MODIFIED' }))).toBe(true);
  });

  it('ignores a column opt-out on a created table rather than half-applying it', () => {
    // CREATE TABLE is rendered from sourceTable, so honouring the diff side
    // alone would have produced a table with the column and a checkbox
    // claiming otherwise.
    const out = applySelectionToDiff(created, { columnSelection: { A: false } });
    expect(out.columnDiffs.map((c) => c.name)).toEqual(['A']);
    expect(out.sourceTable!.columns.map((c) => c.name)).toEqual(['a']);
    expect(out.sourceTable!.indices).toHaveLength(1);
  });

  it('ignores a trigger opt-out there too', () => {
    // Same reason: a create emits its triggers from sourceTable.triggers.
    const withTrigger = {
      ...created,
      triggerDiffs: [{ name: 'TRG', status: 'ADDED' as const }],
    } as TableDiff;
    expect(applyTriggerSelection(withTrigger, { TRG: false })).toHaveLength(1);
  });

  it('still honours both on a modified table', () => {
    const modified = table({
      status: 'MODIFIED',
      columnDiffs: [col('A', 'ADDED'), col('B', 'ADDED')],
      triggerDiffs: [{ name: 'TRG', status: 'ADDED' }],
    } as Partial<TableDiff>);
    const out = applySelectionToDiff(modified, {
      columnSelection: { B: false },
      triggerSelection: { TRG: false },
    });
    expect(out.columnDiffs.map((c) => c.name)).toEqual(['A']);
    expect(out.triggerDiffs).toEqual([]);
  });
});
