/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The container's job is the three states the graph itself refuses to know
 * about: loading, failed, and empty. The graph is covered by buildGraph's own
 * tests against a fixture.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VersionGraphDTO } from './graphTypes';

const listLokeeDatabases = vi.fn();
const loadVersionGraph = vi.fn();
const captureSchema = vi.fn();

vi.mock('../../api/lokeeApi', () => ({
  listLokeeDatabases: (...args: unknown[]) => listLokeeDatabases(...args),
  loadVersionGraph: (...args: unknown[]) => loadVersionGraph(...args),
  captureSchema: (...args: unknown[]) => captureSchema(...args),
}));

vi.mock('../../store/useSyncStore', () => ({
  useSyncStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      connections: [
        { id: 'c1', name: 'Local PG', dialect: 'postgres', hasPassword: true },
      ],
      selectedTargetConnectionId: 'c1',
      targetConfig: {
        dialect: 'postgres',
        option: { host: 'localhost', database: 'foxdb' },
        schema: 'public',
      },
    }),
}));

vi.mock('../../store/uiStore', () => ({
  useUiStore: (sel: (s: { lokeeEpoch: number; bumpLokeeEpoch: () => void }) => unknown) =>
    sel({ lokeeEpoch: 0, bumpLokeeEpoch: () => undefined }),
}));

vi.mock('../../store/toastStore', () => ({
  toast: vi.fn(),
}));

vi.mock('../../lib/sessionPasswords', () => ({
  getSessionPassword: () => undefined,
}));

// React Flow needs layout APIs jsdom does not provide; the graph's own
// behaviour is tested in buildGraph.test.ts, so a marker stands in for it here.
vi.mock('./LokeeWeavePage', () => ({
  LokeeWeavePage: ({ subtitle }: { subtitle?: string }) => (
    <div data-testid="graph">{subtitle ?? 'no-subtitle'}</div>
  ),
}));

import { LokeeWeaveView } from './LokeeWeaveView';
import { toast } from '../../store/toastStore';
import { useLokeeHistoryStore } from '../../store/lokeeHistoryStore';

const DB = {
  id: 'db1',
  dialect: 'postgres',
  host: 'localhost',
  database: 'foxdb',
  schema: 'public',
  versionCount: 2,
  lastSeenAt: '2026-08-11T00:00:00.000Z',
};

const DTO: VersionGraphDTO = {
  databaseId: 'db1',
  versions: [
    { id: 'v2', number: 2, createdAt: '2026-08-11T00:00:00.000Z', rootHash: 'bbb' },
    { id: 'v1', number: 1, createdAt: '2026-08-10T00:00:00.000Z', rootHash: 'aaa' },
  ],
  objects: [],
  totalVersions: 2,
  totalObjects: 3,
    truncatedObjects: false,
};

beforeEach(() => {
  listLokeeDatabases.mockReset();
  loadVersionGraph.mockReset();
  captureSchema.mockReset();
  vi.mocked(toast).mockReset();
  useLokeeHistoryStore.setState({
    databaseId: null,
    originalVersionId: null,
    targetVersionId: null,
    databases: [],
    versions: [],
  });
});

describe('LokeeWeaveView', () => {
  it('renders the graph once history arrives', async () => {
    listLokeeDatabases.mockResolvedValue([DB]);
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: false });

    render(<LokeeWeaveView />);

    await waitFor(() => expect(screen.getByTestId('graph')).toBeTruthy());
    // The subtitle must name the database, not the saved connection.
    expect(screen.getByTestId('graph').textContent).toContain('[postgres] localhost/foxdb.public');
    // The chrome row is gone — Refresh and Capture moved into HistoryCompareBar.
    expect(screen.queryByTestId('lokee-weave-chrome')).toBeNull();
  });

  it('shows an empty state rather than an empty canvas', async () => {
    listLokeeDatabases.mockResolvedValue([DB]);
    loadVersionGraph.mockResolvedValue({ ...DTO, versions: [], truncatedObjects: false });

    render(<LokeeWeaveView />);

    await waitFor(() => expect(screen.getByText('No schema history yet')).toBeTruthy());
    expect(screen.queryByTestId('graph')).toBeNull();
  });

  it('surfaces a failed load instead of pretending there is no history', async () => {
    // An empty state here would be a lie: it says "nothing happened" when the
    // truth is "we could not find out".
    listLokeeDatabases.mockResolvedValue([DB]);
    loadVersionGraph.mockRejectedValue(new Error('connection refused'));

    render(<LokeeWeaveView />);

    await waitFor(() =>
      expect(screen.getByText('Could not load schema history')).toBeTruthy()
    );
    expect(screen.getByText('connection refused')).toBeTruthy();
    expect(screen.queryByText('No schema history yet')).toBeNull();
  });

  it('still shows the graph when the database list fails', async () => {
    // The list only supplies a label; losing it must not hide the history.
    listLokeeDatabases.mockRejectedValue(new Error('nope'));
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: false });

    render(<LokeeWeaveView databaseId="db1" />);

    await waitFor(() => expect(screen.getByTestId('graph')).toBeTruthy());
    expect(screen.getByTestId('graph').textContent).toContain('no-subtitle');
  });

  it('warns when the graph is showing only part of the schema', async () => {
    listLokeeDatabases.mockResolvedValue([DB]);
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: true });

    render(<LokeeWeaveView />);

    await waitFor(() => expect(screen.getByTestId('graph')).toBeTruthy());
    expect(screen.getByText(/more objects than the graph draws/i)).toBeTruthy();
  });

  it('does not fetch a graph when there is no database at all', async () => {
    listLokeeDatabases.mockResolvedValue([]);

    render(<LokeeWeaveView />);

    await waitFor(() => expect(screen.getByText('No schema history yet')).toBeTruthy());
    expect(loadVersionGraph).not.toHaveBeenCalled();
  });

  it('prefers an explicit databaseId over the most recent one', async () => {
    listLokeeDatabases.mockResolvedValue([DB, { ...DB, id: 'db2' }]);
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: false });

    render(<LokeeWeaveView databaseId="db2" />);

    await waitFor(() => expect(loadVersionGraph).toHaveBeenCalled());
    expect(loadVersionGraph).toHaveBeenCalledWith('db2', 20);
  });

  it('hides the in-graph database picker when embedded (toolbar owns Original → Target)', async () => {
    listLokeeDatabases.mockResolvedValue([DB]);
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: false });

    render(<LokeeWeaveView embedded />);

    await waitFor(() => expect(screen.getByTestId('graph')).toBeTruthy());
    expect(screen.queryByTestId('lokee-database-select')).toBeNull();
    expect(useLokeeHistoryStore.getState().databaseId).toBe('db1');
    expect(useLokeeHistoryStore.getState().versions.map((v) => v.id)).toEqual(['v2', 'v1']);
  });

  it('captures when the toolbar bar asks for it', async () => {
    // The credential picker and Capture button moved to HistoryCompareBar, which
    // renders in TopToolbar. It asks by bumping the store counter, so that is
    // the seam to test here rather than a button this component no longer owns.
    listLokeeDatabases.mockResolvedValueOnce([]).mockResolvedValue([DB]);
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: false });
    captureSchema.mockResolvedValue({
      databaseId: 'db1',
      versionId: 'v1',
      versionNumber: 1,
      rootHash: 'aaa',
      changed: true,
      changeCount: 3,
      objectCount: 10,
    });

    render(<LokeeWeaveView />);
    await waitFor(() => expect(listLokeeDatabases).toHaveBeenCalled());

    act(() => {
      useLokeeHistoryStore.getState().setCaptureConnectionId('c1');
      useLokeeHistoryStore.getState().requestCapture();
    });

    await waitFor(() =>
      expect(captureSchema).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'c1', source: 'manual' })
      )
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Captured v1' }))
    );
  });

  it('does not capture or refetch on mount — the counters start at zero', async () => {
    // A naive effect on the request counters would fire once per mount, so a
    // visit to History would silently snapshot the database.
    listLokeeDatabases.mockResolvedValue([DB]);
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: false });

    render(<LokeeWeaveView />);
    await waitFor(() => expect(screen.getByTestId('graph')).toBeTruthy());

    expect(captureSchema).not.toHaveBeenCalled();
    expect(loadVersionGraph).toHaveBeenCalledTimes(1);
  });
});
