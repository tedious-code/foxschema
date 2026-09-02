/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Autocomplete is the dropdown for pickers that used to be a native
 * <select>. What matters is that reopening it still lets the reader browse:
 * a list filtered by the value already in the box shows exactly one row.
 */
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Autocomplete } from './Autocomplete';

const options = [
  { value: 'customers', hint: '2 idx' },
  { value: 'orders', hint: '1 idx' },
  { value: 'order_items' },
  { value: 'products' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Autocomplete value={value} onChange={setValue} options={options} data-testid="pick" />
  );
}

const rows = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');

describe('Autocomplete as a dropdown', () => {
  it('shows every option on focus, even when a value is already picked', () => {
    render(<Harness initial="orders" />);
    fireEvent.focus(screen.getByTestId('pick'));
    expect(screen.getAllByRole('option')).toHaveLength(4);
    // The picked row is the highlighted one, so Enter keeps it.
    const active = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');
    expect(active?.textContent).toContain('orders');
  });

  it('filters once the reader types', () => {
    render(<Harness initial="orders" />);
    const input = screen.getByTestId('pick');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ord' } });
    expect(rows().join('|')).toMatch(/orders/);
    expect(rows().join('|')).toMatch(/order_items/);
    expect(rows().join('|')).not.toMatch(/customers/);
  });

  it('opens from the chevron and picks with a click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('pick-toggle'));
    expect(screen.getAllByRole('option')).toHaveLength(4);
    fireEvent.click(screen.getByText('products'));
    expect((screen.getByTestId('pick') as HTMLInputElement).value).toBe('products');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('shows the hint beside the name', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByTestId('pick'));
    expect(rows()[0]).toContain('customers');
    expect(rows()[0]).toContain('2 idx');
  });

  it('renders two rows for options that share a value but differ in hint', () => {
    // A user and a role can have the same name; the picker must show both.
    const same = [
      { value: 'analysts', hint: 'user' },
      { value: 'analysts', hint: 'role' },
    ];
    render(<Autocomplete value="" onChange={() => undefined} options={same} data-testid="dup" />);
    fireEvent.focus(screen.getByTestId('dup'));
    expect(rows()).toEqual(['analystsuser', 'analystsrole']);
  });

  it('does not say "No matches" for an unfiltered picked value with no options', () => {
    // A free-text field with no catalog yet must not nag on focus.
    const { container } = render(
      <Autocomplete value="anything" onChange={() => undefined} options={[]} data-testid="free" />
    );
    fireEvent.focus(screen.getByTestId('free'));
    expect(container.textContent).not.toMatch(/No matches/);
  });
});
