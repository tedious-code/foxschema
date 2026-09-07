/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { DataPeekPanel } from './DataPeekPanel';

const fetchTableInsight = vi.fn();
vi.mock('@/shared/api/schemaApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/schemaApi')>();
  return {
    ...actual,
    fetchTableInsight: (...args: unknown[]) => fetchTableInsight(...args),
  };
});

const entry = {
  id: 'e1',
  title: 'public.orders',
  tableName: 'public.orders',
  baseSql: 'SELECT * FROM public.orders',
  baseParams: [] as unknown[],
  whereClause: '',
  orderByClause: '',
  limit: 50,
  pageIndex: 0,
  sql: 'SELECT * FROM public.orders',
  params: [] as unknown[],
  status: 'ready' as const,
  result: {
    ok: true as const,
    columns: ['id'],
    rows: [[1]],
    rowCount: 1,
    truncated: false,
    durationMs: 1,
  },
};

describe('DataPeekPanel Insight tab', () => {
  beforeEach(() => {
    fetchTableInsight.mockReset();
    fetchTableInsight.mockResolvedValue({
      table: 'orders',
      schema: 'public',
      estimatedRows: 10,
      columns: [{ name: 'id', nDistinct: 10, nullFrac: 0 }],
      mode: 'catalog',
      support: { mode: 'catalog', query: true, hint: '' },
    });
    useSqlEditorStore.setState({
      dataPeek: {
        connectionId: 'c1',
        dialect: 'postgres',
        entries: [entry],
      },
    });
  });

  afterEach(() => {
    useSqlEditorStore.setState({ dataPeek: null });
  });

  it('does not fetch catalog insight until the Insight tab is selected', async () => {
    render(<DataPeekPanel />);
    expect(screen.getByTestId('data-peek')).toBeTruthy();
    expect(screen.queryByTestId('data-peek-insight')).toBeNull();
    expect(fetchTableInsight).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('data-peek-tab-insight-e1'));
    await waitFor(() => expect(fetchTableInsight).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('data-peek-insight')).toBeTruthy();
  });
});
