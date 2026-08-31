/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The grid draws rows in view order and everyone outside it counts in source
 * order.
 *
 * Sorting and filtering changed what is drawn without changing what is handed
 * outward, so a sorted grid reported the on-screen position to callers that
 * index `result.rows`. Selecting the top row of a sorted grid then edited
 * whichever record happened to be first *unsorted* — the wrong row edited, the
 * wrong row deleted, the wrong parent opened by an FK link.
 *
 * These tests pin the translation at that boundary. They deliberately use a
 * result whose sorted order differs from its stored order, because with three
 * identical orderings the bug is invisible.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataGrid } from './DataGrid';

/** Stored order is Cara, Ada, Bob — sorting by name reverses the first two. */
const RESULT = {
  ok: true as const,
  columns: ['id', 'name'],
  rows: [
    [3, 'Cara'],
    [1, 'Ada'],
    [2, 'Bob'],
  ],
  rowCount: 3,
  truncated: false,
  durationMs: 1,
};

const sortByName = () => {
  // The header's own sort control; column 1 is `name`.
  fireEvent.click(screen.getByTestId('sql-col-sort-1'));
};

describe('row identity survives sorting', () => {
  it('reports the source position, not the on-screen one', () => {
    const onSelectRow = vi.fn();
    render(<DataGrid result={RESULT} onSelectRow={onSelectRow} />);

    sortByName();
    // On screen: Ada, Bob, Cara. Ada is drawn first but is stored second.
    fireEvent.click(screen.getByText('Ada').closest('tr')!);

    expect(onSelectRow).toHaveBeenCalledWith(1);
  });

  it('still reports the right row for the last one on screen', () => {
    const onSelectRow = vi.fn();
    render(<DataGrid result={RESULT} onSelectRow={onSelectRow} />);

    sortByName();
    // Cara is drawn last after sorting but is stored first.
    fireEvent.click(screen.getByText('Cara').closest('tr')!);

    expect(onSelectRow).toHaveBeenCalledWith(0);
  });

  it('highlights the selected record wherever the sort moved it', () => {
    // `selectedRowIndex` arrives as a source position; the highlight has to
    // land on the row now drawing that record, not on that screen position.
    render(<DataGrid result={RESULT} selectedRowIndex={0} onSelectRow={() => undefined} />);
    sortByName();

    const cara = screen.getByText('Cara').closest('tr')!;
    expect(cara.className).toContain('amber');
  });

  it('is unchanged when no sort is active', () => {
    const onSelectRow = vi.fn();
    render(<DataGrid result={RESULT} onSelectRow={onSelectRow} />);
    fireEvent.click(screen.getByText('Ada').closest('tr')!);
    expect(onSelectRow).toHaveBeenCalledWith(1);
  });

  it('reports the source position through a filter too', () => {
    const onSelectRow = vi.fn();
    render(<DataGrid result={RESULT} onSelectRow={onSelectRow} />);

    fireEvent.click(screen.getByTestId('sql-grid-filter-toggle'));
    fireEvent.change(screen.getByTestId('sql-filter-value-1'), { target: { value: 'bob' } });

    // Only Bob is drawn, at screen position 0; he is stored at 2.
    fireEvent.click(screen.getByText('Bob').closest('tr')!);
    expect(onSelectRow).toHaveBeenCalledWith(2);
  });
});
