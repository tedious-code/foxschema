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

describe('applySelectionToDiff', () => {
  // The generator renders CREATE TABLE from sourceTable.columns, never from the
  // diffs, so filtering only the diffs left a new table with every column and
  // the checkbox doing nothing at all.
  const created = {
    ...table({
      tableName: 'ORDERS',
      status: 'ADDED',
      columnDiffs: [col('ID', 'ADDED', { primaryKey: true }), col('NOTE', 'ADDED')],
    }),
    sourceTable: {
      name: 'orders',
      columns: [
        { name: 'id', type: 'int', nullable: false },
        { name: 'note', type: 'text', nullable: true },
      ],
    },
  } as TableDiff;

  it('drops the column from the CREATE, not just the diff list', () => {
    const out = applySelectionToDiff(created, { columnSelection: { NOTE: false } });
    expect(out.columnDiffs.map((c) => c.name)).toEqual(['ID']);
    expect(out.sourceTable!.columns.map((c) => c.name)).toEqual(['id']);
  });

  it('leaves sourceTable alone when nothing was dropped', () => {
    const out = applySelectionToDiff(created, {});
    expect(out.sourceTable!.columns).toHaveLength(2);
  });

  it('keeps a blocked column in both places', () => {
    const out = applySelectionToDiff(created, { columnSelection: { ID: false } });
    expect(out.columnDiffs.map((c) => c.name)).toContain('ID');
    expect(out.sourceTable!.columns.map((c) => c.name)).toContain('id');
  });

  it('applies the trigger opt-out too', () => {
    const withTriggers = {
      ...created,
      triggerDiffs: [{ name: 'TRG', status: 'ADDED' as const }],
    } as TableDiff;
    const out = applySelectionToDiff(withTriggers, { triggerSelection: { TRG: false } });
    expect(out.triggerDiffs).toEqual([]);
  });
});

describe('a created table trims what CREATE emits', () => {
  // The generator renders indexes and keys from sourceTable, not the diffs, so
  // trimming columns alone left CREATE INDEX naming a column the CREATE TABLE
  // no longer had — failing after the table already exists.
  const created = {
    ...table({
      tableName: 'ORDERS',
      status: 'ADDED',
      columnDiffs: [col('KEEP', 'ADDED'), col('GONE', 'ADDED')],
    }),
    sourceTable: {
      name: 'orders',
      columns: [
        { name: 'keep', type: 'text', nullable: true },
        { name: 'gone', type: 'text', nullable: true },
      ],
      indices: [
        { name: 'idx_gone', columns: ['gone'], unique: false },
        { name: 'idx_keep', columns: ['keep'], unique: false },
      ],
      foreignKeys: [
        { name: 'fk_gone', columns: ['gone'], referencedTable: 'x', referencedColumns: ['id'] },
      ],
    },
  } as unknown as TableDiff;

  it('drops an index whose every column is gone', () => {
    const out = applySelectionToDiff(created, { columnSelection: { GONE: false } });
    expect(out.sourceTable!.indices.map((i) => i.name)).toEqual(['idx_keep']);
  });

  it('drops a foreign key whose every column is gone', () => {
    const out = applySelectionToDiff(created, { columnSelection: { GONE: false } });
    expect(out.sourceTable!.foreignKeys).toEqual([]);
  });

  it('pins a column an index shares with a surviving one', () => {
    // Trimming here would silently rewrite the index to (keep), which is not
    // what the reader asked for. Refusing is the honest answer.
    const shared = {
      ...created,
      sourceTable: {
        ...created.sourceTable!,
        indices: [{ name: 'idx_pair', columns: ['keep', 'gone'], unique: false }],
      },
    } as TableDiff;
    const block = columnExclusionBlock(shared, 'GONE');
    expect(block?.reason).toMatch(/idx_pair/);
    expect(block?.reason).toMatch(/rewrite/i);

    const out = applySelectionToDiff(shared, { columnSelection: { GONE: false } });
    expect(out.sourceTable!.columns.map((c) => c.name)).toContain('gone');
    expect(out.sourceTable!.indices).toHaveLength(1);
  });
});

describe('a composite index does not pin its own columns forever', () => {
  // Each column pinned the other, so the pair could never be excluded together
  // — even though the index is dropped whole once every column it names is
  // gone. "Staying" has to mean "not itself excluded", not "not this one".
  const created = {
    ...table({
      tableName: 'ORDERS',
      status: 'ADDED',
      columnDiffs: [col('A', 'ADDED'), col('B', 'ADDED'), col('C', 'ADDED')],
    }),
    sourceTable: {
      name: 'orders',
      columns: [
        { name: 'a', type: 'text', nullable: true },
        { name: 'b', type: 'text', nullable: true },
        { name: 'c', type: 'text', nullable: true },
      ],
      indices: [{ name: 'idx_pair', columns: ['a', 'b'], unique: false }],
      foreignKeys: [],
    },
  } as unknown as TableDiff;

  it('pins one column while the other is staying', () => {
    const block = columnExclusionBlock(created, 'A', { columnSelection: {} });
    expect(block?.reason).toMatch(/idx_pair/);
    // The message names what to untick first.
    expect(block?.reason).toMatch(/\bb\b/);
  });

  it('frees it once the other is excluded too', () => {
    expect(columnExclusionBlock(created, 'A', { columnSelection: { B: false } })).toBeNull();
  });

  it('lets both go together, taking the index with them', () => {
    const out = applySelectionToDiff(created, { columnSelection: { A: false, B: false } });
    expect(out.sourceTable!.columns.map((c) => c.name)).toEqual(['c']);
    expect(out.sourceTable!.indices).toEqual([]);
  });

  it('still keeps the index when only one column goes', () => {
    const out = applySelectionToDiff(created, { columnSelection: { A: false } });
    expect(out.sourceTable!.columns.map((c) => c.name)).toContain('a');
    expect(out.sourceTable!.indices).toHaveLength(1);
  });
});
