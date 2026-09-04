/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SchemaDiffTree } from './SchemaDiffTree';
import type { TableDiff } from '@/shared/lib/types';

function table(partial: Partial<TableDiff> & Pick<TableDiff, 'tableName'>): TableDiff {
  return {
    objectType: 'TABLE',
    status: 'UNCHANGED',
    columnDiffs: [],
    indexDiffs: [],
    foreignKeyDiffs: [],
    ...partial,
  };
}

describe('SchemaDiffTree does not duplicate the blueprint', () => {
  it('does not list indexes under the table name', () => {
    // The tree used to nest them, expandable. It duplicated the blueprint —
    // which lists the same indexes with the deploy checkboxes that actually do
    // something — while pushing the object names off the screen. The count
    // stays as a summary on the name line.
    const onSelect = vi.fn();
    render(
      <SchemaDiffTree
        tables={[
          table({
            tableName: 'CUSTOMERS',
            indexDiffs: [
              {
                name: 'IDX_EMAIL',
                status: 'UNCHANGED',
                source: { name: 'IDX_EMAIL', columns: ['EMAIL'], unique: true },
              },
            ],
          }),
        ]}
        onSelect={onSelect}
        showStatusBadge={false}
      />
    );

    expect(screen.queryByTestId('diff-item-indexes-CUSTOMERS')).toBeNull();
    expect(screen.queryByTestId('diff-item-index-CUSTOMERS-IDX_EMAIL')).toBeNull();
    expect(screen.queryByTestId('diff-item-expand-CUSTOMERS')).toBeNull();
    expect(screen.getByTestId('diff-item').textContent).toContain('1 idx');
  });

  it('selects the table when the row is clicked, with nothing to expand', () => {
    const onSelect = vi.fn();
    render(
      <SchemaDiffTree
        tables={[table({ tableName: 'CUSTOMERS' })]}
        onSelect={onSelect}
        showStatusBadge={false}
      />
    );

    fireEvent.click(screen.getByTestId('diff-item'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('diff-item-indexes-CUSTOMERS')).toBeNull();
  });
});
