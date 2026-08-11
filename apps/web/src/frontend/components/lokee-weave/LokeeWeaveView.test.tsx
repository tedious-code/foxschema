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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useSyncStore: (sel: (s: { connections: unknown[] }) => unknown) =>
    sel({
      connections: [
        { id: 'c1', name: 'Local PG', dialect: 'postgres', hasPassword: true },
      ],
    }),
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
};

beforeEach(() => {
  listLokeeDatabases.mockReset();
  loadVersionGraph.mockReset();
  captureSchema.mockReset();
  vi.mocked(toast).mockReset();
});

describe('LokeeWeaveView', () => {
  it('renders the graph once history arrives', async () => {
    listLokeeDatabases.mockResolvedValue([DB]);
    loadVersionGraph.mockResolvedValue({ ...DTO, truncatedObjects: false });

    render(<LokeeWeaveView />);

    await waitFor(() => expect(screen.getByTestId('graph')).toBeTruthy());
    // The subtitle must name the database, not the saved connection.
    expect(screen.getByTestId('graph').textContent).toContain('[postgres] localhost/foxdb.public');
    expect(screen.getByTestId('lokee-weave-chrome')).toBeTruthy();
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

  it('captures a schema from the chosen credential', async () => {
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

    await waitFor(() => expect(screen.getByTestId('lokee-capture-btn')).toBeTruthy());
    fireEvent.change(screen.getByTestId('lokee-capture-connection'), {
      target: { value: 'c1' },
    });
    fireEvent.click(screen.getByTestId('lokee-capture-btn'));

    await waitFor(() =>
      expect(captureSchema).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'c1', source: 'manual' })
      )
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Captured v1' }))
    );
  });
});
