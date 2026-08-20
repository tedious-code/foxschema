/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SchemaDiffTree } from './SchemaDiffTree';
import type { TableDiff } from '../lib/types';

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

describe('SchemaDiffTree expand/collapse indexes', () => {
  it('hides index details until the table is expanded', () => {
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
    expect(screen.getByTestId('diff-item').getAttribute('data-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('diff-item-expand-CUSTOMERS'));

    expect(screen.getByTestId('diff-item-indexes-CUSTOMERS')).toBeTruthy();
    expect(screen.getByTestId('diff-item-index-CUSTOMERS-IDX_EMAIL').textContent).toContain(
      'IDX_EMAIL'
    );
    expect(screen.getByTestId('diff-item-index-CUSTOMERS-IDX_EMAIL').textContent).toMatch(/unique/i);
    expect(screen.getByTestId('diff-item-index-CUSTOMERS-IDX_EMAIL').textContent).toContain('EMAIL');
    expect(screen.getByTestId('diff-item').getAttribute('data-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('diff-item-expand-CUSTOMERS'));
    expect(screen.queryByTestId('diff-item-indexes-CUSTOMERS')).toBeNull();
  });

  it('expands the table when the row is clicked so indexes are visible', () => {
    const onSelect = vi.fn();
    render(
      <SchemaDiffTree
        tables={[
          table({
            tableName: 'ORDERS',
            indexDiffs: [
              {
                name: 'PK_ORDERS',
                status: 'UNCHANGED',
                source: { name: 'PK_ORDERS', columns: ['ID'], unique: true },
              },
            ],
          }),
        ]}
        onSelect={onSelect}
        showStatusBadge={false}
      />
    );

    fireEvent.click(screen.getByTestId('diff-item'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('diff-item-indexes-ORDERS')).toBeTruthy();
  });
});
