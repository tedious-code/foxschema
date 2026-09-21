/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The single-choice picker. The checklist mode is covered through the SQL
 * editor's destinations in ConnectionChecklist.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  FilterPicker,
  connectionPickerOption,
  type FilterPickerOption,
} from './FilterPicker';

const OPTIONS: FilterPickerOption[] = [
  { id: 'a', label: 'Warehouse', badge: 'PostgreSQL', detail: 'db.internal / dw', testId: 'opt-a' },
  { id: 'b', label: 'Orders', badge: 'MySQL', note: 'links it', testId: 'opt-b' },
];

function renderSingle(selectedId: string | null = null, clearLabel?: string) {
  const onSelect = vi.fn();
  const view = render(
    <div style={{ overflow: 'auto' }}>
      <label htmlFor="picker">Database</label>
      <FilterPicker
        id="picker"
        mode="single"
        testId="picker"
        options={OPTIONS}
        selectedId={selectedId}
        onSelect={onSelect}
        clearLabel={clearLabel}
        summary={selectedId ?? 'Choose…'}
      />
    </div>
  );
  return { onSelect, ...view };
}

const open = () => fireEvent.click(screen.getByTestId('picker-trigger'));

describe('FilterPicker (single)', () => {
  it('picks one option and closes', () => {
    const { onSelect } = renderSingle();
    open();
    fireEvent.click(screen.getByTestId('opt-b'));
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByTestId('picker-filter')).toBeNull();
  });

  it('renders the list outside its container, so a scrolling ancestor cannot clip it', () => {
    const { container } = renderSingle();
    open();
    const filter = screen.getByTestId('picker-filter');
    expect(container.contains(filter)).toBe(false);
    expect(document.body.contains(filter)).toBe(true);
  });

  it('opens from its label', () => {
    renderSingle();
    fireEvent.click(screen.getByText('Database'));
    expect(screen.getByTestId('picker-filter')).toBeTruthy();
  });

  it('filters on the tooltip detail and picks the first match on Enter', () => {
    const { onSelect } = renderSingle();
    open();
    const filter = screen.getByTestId('picker-filter');
    fireEvent.change(filter, { target: { value: 'db.internal' } });
    expect(screen.queryByTestId('opt-b')).toBeNull();
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('marks the chosen option', () => {
    renderSingle('a');
    open();
    expect(screen.getByTestId('opt-a').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('opt-b').getAttribute('aria-selected')).toBe('false');
  });

  it('clears the choice from its clear row', () => {
    const { onSelect } = renderSingle('a', 'None');
    open();
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('closes on Escape without choosing', () => {
    const { onSelect } = renderSingle();
    open();
    fireEvent.keyDown(screen.getByTestId('picker-filter'), { key: 'Escape' });
    expect(screen.queryByTestId('picker-filter')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('searches connection host, database, user, and port via connectionPickerOption', () => {
    const onSelect = vi.fn();
    const options = [
      connectionPickerOption({
        id: 'pg',
        name: 'Warehouse',
        dialect: 'postgres',
        host: 'db.internal',
        port: 5432,
        database: 'dw',
        username: 'analyst',
      }),
      connectionPickerOption({
        id: 'lite',
        name: 'Local',
        dialect: 'sqlite',
        database: '/tmp/demo.db',
      }),
    ].map((o) => ({ ...o, testId: `opt-${o.id}` }));
    render(
      <FilterPicker
        mode="single"
        testId="conn"
        options={options}
        selectedId={null}
        onSelect={onSelect}
        summary="Choose…"
      />
    );
    fireEvent.click(screen.getByTestId('conn-trigger'));
    expect(screen.getByTestId('conn-group-PostgreSQL')).toBeTruthy();
    expect(screen.getByTestId('conn-group-SQLite')).toBeTruthy();
    fireEvent.change(screen.getByTestId('conn-filter'), { target: { value: '5432' } });
    expect(screen.getByTestId('opt-pg')).toBeTruthy();
    expect(screen.queryByTestId('opt-lite')).toBeNull();
    fireEvent.change(screen.getByTestId('conn-filter'), { target: { value: 'analyst' } });
    expect(screen.getByTestId('opt-pg')).toBeTruthy();
    fireEvent.change(screen.getByTestId('conn-filter'), { target: { value: 'dw' } });
    fireEvent.keyDown(screen.getByTestId('conn-filter'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('pg');
  });
});
