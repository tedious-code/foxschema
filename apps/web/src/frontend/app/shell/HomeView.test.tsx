/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HomeView } from './HomeView';

const openRecentQuery = vi.fn();
const ensureConnectionSelected = vi.fn();
const ensureSchema = vi.fn();
const setActiveView = vi.fn();

vi.mock('@/app/store/useSqlEditorStore', () => ({
  useSqlEditorStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      recentQueries: [
        { id: 'r1', sql: 'SELECT 1', title: 'Ping', ranAt: Date.now() },
      ],
      openRecentQuery,
      ensureConnectionSelected,
      ensureSchema,
    }),
}));

vi.mock('@/app/store/useSyncStore', () => ({
  useSyncStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      connections: [{ id: 'c1', name: 'Demo SQLite', dialect: 'sqlite' }],
      compareResult: null,
      sourceConfig: { option: {} },
      targetConfig: { option: {} },
    }),
}));

vi.mock('@/app/store/uiStore', () => ({
  useUiStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ setActiveView }),
}));

describe('HomeView', () => {
  beforeEach(() => {
    openRecentQuery.mockReset();
    ensureConnectionSelected.mockReset();
    ensureSchema.mockReset();
    setActiveView.mockReset();
  });

  it('opens a recent query in the SQL Editor without introspecting', () => {
    render(<HomeView />);
    expect(screen.getByTestId('home-view')).toBeTruthy();
    fireEvent.click(screen.getByTestId('home-recent-r1'));
    expect(openRecentQuery).toHaveBeenCalledWith('r1');
    expect(setActiveView).toHaveBeenCalledWith('sqlEditor');
    expect(ensureSchema).not.toHaveBeenCalled();
  });

  it('opens a saved connection as a SQL destination without introspecting', () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('home-connection-c1'));
    expect(ensureConnectionSelected).toHaveBeenCalledWith('c1');
    expect(setActiveView).toHaveBeenCalledWith('sqlEditor');
    expect(ensureSchema).not.toHaveBeenCalled();
  });

  it('continues into Snapshots from the home cards', () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('home-continue-snapshots'));
    expect(setActiveView).toHaveBeenCalledWith('snapshots');
  });

  it('opens the Utilities workspace from Home', () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('home-continue-utilities'));
    expect(setActiveView).toHaveBeenCalledWith('utilities');
  });
});
