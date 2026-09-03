/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-column and per-trigger deploy checkboxes.
 *
 * The rules about *which* columns may be left out are tested against the SQL in
 * `column-selection.test.ts`. What matters here is that the rendering obeys
 * them: a box that unticks a column the script cannot actually drop would tell
 * the reader they had excluded something they had not.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SchemaBlueprint } from './SchemaBlueprint';
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

function tableDiff(over: Partial<TableDiff> = {}): TableDiff {
  return {
    tableName: 'ORDERS',
    status: 'MODIFIED',
    objectType: 'TABLE',
    columnDiffs: [col('ID', 'ADDED', { primaryKey: true }), col('NOTE', 'ADDED')],
    indexDiffs: [],
    foreignKeyDiffs: [],
    triggerDiffs: [{ name: 'TRG_AUDIT', status: 'ADDED' }],
    ...over,
  } as TableDiff;
}

describe('column checkboxes', () => {
  it('are ticked by default', () => {
    // Opt-out: a fresh compare migrates everything, exactly as before this
    // feature existed. Nothing is silently dropped by adding the control.
    render(<SchemaBlueprint diff={tableDiff()} onToggleColumn={() => undefined} />);
    const box = screen.getByTestId('blueprint-column-check-NOTE') as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('report the column when clicked', () => {
    const onToggleColumn = vi.fn();
    render(<SchemaBlueprint diff={tableDiff()} onToggleColumn={onToggleColumn} />);
    fireEvent.click(screen.getByTestId('blueprint-column-check-NOTE'));
    expect(onToggleColumn).toHaveBeenCalledWith('NOTE');
  });

  it('show a column as excluded once it is set to false', () => {
    render(
      <SchemaBlueprint
        diff={tableDiff()}
        columnSelection={{ NOTE: false }}
        onToggleColumn={() => undefined}
      />
    );
    expect((screen.getByTestId('blueprint-column-check-NOTE') as HTMLInputElement).checked).toBe(
      false
    );
  });

  it('disable a primary key column and say why', () => {
    // A CREATE TABLE cannot omit a column its key names, so the box stays
    // ticked and disabled rather than pretending the choice exists.
    render(<SchemaBlueprint diff={tableDiff()} onToggleColumn={() => undefined} />);
    const pk = screen.getByTestId('blueprint-column-check-ID') as HTMLInputElement;
    expect(pk.disabled).toBe(true);
    expect(pk.checked).toBe(true);
    expect(pk.getAttribute('title')).toMatch(/primary key/i);
  });

  it('disable a column an opted-in index names', () => {
    const diff = tableDiff({
      columnDiffs: [col('EMAIL', 'ADDED')],
      indexDiffs: [
        {
          name: 'IDX_EMAIL',
          status: 'ADDED',
          source: { name: 'idx_email', columns: ['email'], unique: true },
        },
      ],
    } as Partial<TableDiff>);

    const { rerender } = render(
      <SchemaBlueprint diff={diff} indexSelection={{ IDX_EMAIL: true }} onToggleColumn={() => undefined} />
    );
    expect((screen.getByTestId('blueprint-column-check-EMAIL') as HTMLInputElement).disabled).toBe(
      true
    );

    // Indexes are opt-in. With the index un-ticked nothing in the script names
    // the column, so the reader is free to leave it out again.
    rerender(
      <SchemaBlueprint diff={diff} indexSelection={{}} onToggleColumn={() => undefined} />
    );
    expect((screen.getByTestId('blueprint-column-check-EMAIL') as HTMLInputElement).disabled).toBe(
      false
    );
  });

  it('leave unchanged columns without a box', () => {
    // There is no statement to include or exclude.
    render(
      <SchemaBlueprint
        diff={tableDiff({ columnDiffs: [col('OLD', 'UNCHANGED')] })}
        showUnchanged
        onToggleColumn={() => undefined}
      />
    );
    expect(screen.queryByTestId('blueprint-column-check-OLD')).toBeNull();
  });

  it('offer a select-all that reports the new state', () => {
    const onSelectAllColumns = vi.fn();
    render(
      <SchemaBlueprint
        diff={tableDiff()}
        onToggleColumn={() => undefined}
        onSelectAllColumns={onSelectAllColumns}
      />
    );
    const all = screen.getByTestId('blueprint-columns-all').querySelector('input')!;
    expect((all as HTMLInputElement).checked).toBe(true);
    fireEvent.click(all);
    expect(onSelectAllColumns).toHaveBeenCalledWith(false);
  });

  it('are absent on a role, which uses member checkboxes instead', () => {
    render(
      <SchemaBlueprint
        diff={tableDiff({ objectType: 'ROLE' } as Partial<TableDiff>)}
        onToggleColumn={() => undefined}
        onToggleMember={() => undefined}
      />
    );
    expect(screen.queryByTestId('blueprint-column-check-NOTE')).toBeNull();
  });
});

describe('trigger checkboxes', () => {
  it('are ticked by default and report the trigger', () => {
    const onToggleTriggerSelection = vi.fn();
    render(
      <SchemaBlueprint diff={tableDiff()} onToggleTriggerSelection={onToggleTriggerSelection} />
    );
    const box = screen.getByTestId('blueprint-trigger-check-TRG_AUDIT') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onToggleTriggerSelection).toHaveBeenCalledWith('TRG_AUDIT');
  });

  it('do not expand the DDL diff when ticked', () => {
    // The row itself toggles the diff, so a bare click would both tick the box
    // and expand the row — one gesture doing two things the reader did not ask
    // for together.
    const onToggleTrigger = vi.fn();
    render(
      <SchemaBlueprint
        diff={tableDiff()}
        onToggleTrigger={onToggleTrigger}
        onToggleTriggerSelection={() => undefined}
      />
    );
    fireEvent.click(screen.getByTestId('blueprint-trigger-check-TRG_AUDIT'));
    expect(onToggleTrigger).not.toHaveBeenCalled();
  });

  it('still expand when the row itself is clicked', () => {
    const onToggleTrigger = vi.fn();
    render(
      <SchemaBlueprint
        diff={tableDiff()}
        onToggleTrigger={onToggleTrigger}
        onToggleTriggerSelection={() => undefined}
      />
    );
    fireEvent.click(screen.getByText('TRG_AUDIT').closest('tr')!);
    expect(onToggleTrigger).toHaveBeenCalledWith('TRG_AUDIT');
  });

  it('show a trigger as excluded once it is set to false', () => {
    render(
      <SchemaBlueprint
        diff={tableDiff()}
        triggerSelection={{ TRG_AUDIT: false }}
        onToggleTriggerSelection={() => undefined}
      />
    );
    expect(
      (screen.getByTestId('blueprint-trigger-check-TRG_AUDIT') as HTMLInputElement).checked
    ).toBe(false);
  });
});

describe('cross-table pins reach the checkbox', () => {
  // Without the sibling list the box looked free to untick while the store kept
  // the column anyway — a control showing an exclusion the script ignores.
  const parent = tableDiff({
    tableName: 'CUSTOMERS',
    columnDiffs: [col('ID', 'ADDED')],
    triggerDiffs: [],
  } as Partial<TableDiff>);
  const child = tableDiff({
    tableName: 'ORDERS',
    columnDiffs: [],
    triggerDiffs: [],
    foreignKeyDiffs: [
      {
        name: 'FK_ORDERS_CUSTOMER',
        status: 'ADDED',
        source: { columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] },
      },
    ],
  } as Partial<TableDiff>);

  it('disables the parent column when a sibling key references it', () => {
    render(
      <SchemaBlueprint diff={parent} siblingDiffs={[parent, child]} onToggleColumn={() => undefined} />
    );
    const box = screen.getByTestId('blueprint-column-check-ID') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.getAttribute('title')).toMatch(/ORDERS/);
  });

  it('leaves it free when no sibling references it', () => {
    render(<SchemaBlueprint diff={parent} siblingDiffs={[parent]} onToggleColumn={() => undefined} />);
    expect((screen.getByTestId('blueprint-column-check-ID') as HTMLInputElement).disabled).toBe(false);
  });
});
