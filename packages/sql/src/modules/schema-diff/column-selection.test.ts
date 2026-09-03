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
    expect(columnExclusionBlock(t, 'EMAIL', new Set(['OTHER']))).toBeNull();
    expect(columnExclusionBlock(t, 'EMAIL', new Set(['IDX']))).not.toBeNull();
    // An empty set is "opted into none", not "unknown": nothing blocks.
    expect(columnExclusionBlock(t, 'EMAIL', new Set())).toBeNull();
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
