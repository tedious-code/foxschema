/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PeekInsight, formatBytes } from './PeekInsight';

const fetchTableInsight = vi.fn();
vi.mock('@/shared/api/schemaApi', () => ({
  fetchTableInsight: (...args: unknown[]) => fetchTableInsight(...args),
}));

vi.mock('@/app/store/useSqlEditorStore', () => ({
  useSqlEditorStore: (sel: (s: { sessionPasswords: Record<string, string> }) => unknown) =>
    sel({ sessionPasswords: {} }),
}));

describe('PeekInsight', () => {
  beforeEach(() => {
    fetchTableInsight.mockReset();
    fetchTableInsight.mockResolvedValue({
      table: 'orders',
      schema: 'public',
      estimatedRows: 1200,
      columns: [{ name: 'id', nDistinct: 1200, nullFrac: 0 }],
      mode: 'catalog',
      support: { mode: 'catalog', query: true, hint: 'pg_stats' },
    });
  });

  it('fetches catalog stats when mounted (Insight tab selected)', async () => {
    render(<PeekInsight connectionId="c1" tableName="public.orders" schema="public" />);
    await waitFor(() => expect(fetchTableInsight).toHaveBeenCalledTimes(1));
    expect(fetchTableInsight).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1' }),
      expect.objectContaining({ table: 'orders', schema: 'public' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('data-peek-insight-rows').textContent).toMatch(/1,200/)
    );
    expect(screen.getByTestId('data-peek-insight-col-id')).toBeTruthy();
  });
});

describe('formatBytes', () => {
  it('keeps small tables in bytes rather than rounding them to 0 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('shows one decimal under 10 so 1.2 GB does not read as 1 GB', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1.25)).toBe('1.3 GB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('drops the decimal above 10, where it is noise against the rounding already there', () => {
    expect(formatBytes(1024 * 1024 * 890)).toBe('890 MB');
  });

  it('refuses to invent a size from a nonsense figure', () => {
    // A negative or non-finite size means the catalog answered with something
    // this code does not understand. "—" says that; "0 B" would claim the
    // table is empty.
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
})
