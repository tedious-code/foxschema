/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-column and per-trigger opt-outs, where they meet the deploy script.
 *
 * The rules live in `@foxschema/sql`; the checkbox lives in the blueprint. This
 * is the seam between them — the point where unticking a box has to actually
 * remove a statement. A control that changes nothing downstream is worse than
 * no control, because the reader believes they excluded something.
 */
import { describe, expect, it } from 'vitest';
import { buildIncludedDiffs, type DeploySelections } from './sync-helpers';
import type { TableDiff } from '@/shared/lib/types';

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

function orders(over: Partial<TableDiff> = {}): TableDiff {
  return {
    tableName: 'ORDERS',
    status: 'MODIFIED',
    objectType: 'TABLE',
    columnDiffs: [col('ID', 'ADDED', { primaryKey: true }), col('NOTE', 'ADDED')],
    indexDiffs: [],
    foreignKeyDiffs: [],
    triggerDiffs: [
      { name: 'TRG_A', status: 'ADDED' },
      { name: 'TRG_B', status: 'ADDED' },
    ],
    ...over,
  } as TableDiff;
}

const selections = (over: Partial<DeploySelections> = {}): DeploySelections => ({
  selection: { ORDERS: true },
  memberSelection: {},
  indexSelection: {},
  ...over,
});

describe('column opt-outs reach the deploy script', () => {
  it('keeps every column when nothing was unticked', () => {
    // The behaviour before this feature existed, and the behaviour of every
    // table nobody has touched.
    const [t] = buildIncludedDiffs([orders()], selections());
    expect(t!.columnDiffs.map((c) => c.name)).toEqual(['ID', 'NOTE']);
  });

  it('drops a column that was unticked', () => {
    const [t] = buildIncludedDiffs(
      [orders()],
      selections({ columnSelection: { ORDERS: { NOTE: false } } })
    );
    expect(t!.columnDiffs.map((c) => c.name)).toEqual(['ID']);
  });

  it('refuses to drop a primary key column', () => {
    // The UI disables this box, but the store is the last line: a stale
    // selection or a future caller must not be able to emit a CREATE TABLE
    // missing the column its key names.
    const [t] = buildIncludedDiffs(
      [orders()],
      selections({ columnSelection: { ORDERS: { ID: false } } })
    );
    expect(t!.columnDiffs.map((c) => c.name)).toContain('ID');
  });

  it('refuses to drop a column an opted-in index names', () => {
    const table = orders({
      columnDiffs: [col('EMAIL', 'ADDED')],
      indexDiffs: [
        {
          name: 'IDX_EMAIL',
          status: 'ADDED',
          source: { name: 'idx_email', columns: ['email'], unique: true },
        },
      ],
    } as Partial<TableDiff>);

    const withIndex = buildIncludedDiffs(
      [table],
      selections({
        columnSelection: { ORDERS: { EMAIL: false } },
        indexSelection: { ORDERS: { IDX_EMAIL: true } },
      })
    );
    expect(withIndex[0]!.columnDiffs.map((c) => c.name)).toContain('EMAIL');

    // Without the index opted in, nothing in the script names the column.
    const withoutIndex = buildIncludedDiffs(
      [table],
      selections({ columnSelection: { ORDERS: { EMAIL: false } } })
    );
    expect(withoutIndex[0]!.columnDiffs.map((c) => c.name)).not.toContain('EMAIL');
  });

  it('leaves role members to their own selection', () => {
    // A role's "columns" are its members; the two selections must not both
    // apply, or a member could be dropped by a control meant for tables.
    const role = orders({
      objectType: 'ROLE',
      tableName: 'READERS',
      columnDiffs: [col('alice', 'ADDED'), col('bob', 'ADDED')],
    } as Partial<TableDiff>);
    const [t] = buildIncludedDiffs(
      [role],
      selections({
        selection: { READERS: true },
        memberSelection: { READERS: { alice: false } },
        columnSelection: { READERS: { bob: false } },
      })
    );
    expect(t!.columnDiffs.map((c) => c.name)).toEqual(['bob']);
  });
});

describe('trigger opt-outs reach the deploy script', () => {
  it('keeps every trigger by default', () => {
    const [t] = buildIncludedDiffs([orders()], selections());
    expect(t!.triggerDiffs!.map((x) => x.name)).toEqual(['TRG_A', 'TRG_B']);
  });

  it('drops a trigger that was unticked', () => {
    const [t] = buildIncludedDiffs(
      [orders()],
      selections({ triggerSelection: { ORDERS: { TRG_A: false } } })
    );
    expect(t!.triggerDiffs!.map((x) => x.name)).toEqual(['TRG_B']);
  });

  it('applies to the table it names and no other', () => {
    const other = orders({ tableName: 'CUSTOMERS' });
    const [o, c] = buildIncludedDiffs(
      [orders(), other],
      selections({
        selection: { ORDERS: true, CUSTOMERS: true },
        triggerSelection: { ORDERS: { TRG_A: false } },
      })
    );
    expect(o!.triggerDiffs!.map((x) => x.name)).toEqual(['TRG_B']);
    expect(c!.triggerDiffs!.map((x) => x.name)).toEqual(['TRG_A', 'TRG_B']);
  });
});
