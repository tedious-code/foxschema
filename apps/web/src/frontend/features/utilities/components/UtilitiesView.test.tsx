/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UtilitiesView } from './UtilitiesView';

vi.mock('./IndexManagementModal', () => ({
  IndexManagementModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="index-management-embed">indexes</div> : null,
}));
vi.mock('./CloneTableModal', () => ({
  CloneTableModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="clone-table-modal">clone</div> : null,
}));
vi.mock('./ServerInsightsModal', () => ({
  ServerInsightsModal: ({
    open,
    initialTab,
  }: {
    open: boolean;
    initialTab?: string;
  }) =>
    open ? (
      <div data-testid="server-insights-modal">
        insights {initialTab}
        <button type="button" data-testid={`server-insights-tab-${initialTab ?? 'pool'}`} />
      </div>
    ) : null,
}));
vi.mock('./DatabaseAccessModal', () => ({
  DatabaseAccessModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="db-access-embedded">grants</div> : null,
}));
vi.mock('./FileQueryModal', () => ({
  FileQueryModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="file-query-modal">files</div> : null,
}));
vi.mock('@/features/sql-editor/components/FileImportsPanel', () => ({
  FileImportsPanel: () => <div data-testid="file-imports-panel">imports</div>,
}));

const UTILITY_BUTTONS = [
  'utilities-index-management',
  'utilities-database-access',
  'utilities-clone-table',
  'utilities-query-files',
  'utilities-connection-pool',
  'utilities-user-connections',
  'utilities-system-info',
  'utilities-object-sizes',
] as const;

describe('UtilitiesView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists every utility in the workspace nav, not the SQL sidebar', () => {
    render(<UtilitiesView />);
    expect(screen.getByTestId('utilities-view')).toBeTruthy();
    const nav = screen.getByTestId('sql-sidebar-utilities');
    for (const id of UTILITY_BUTTONS) {
      expect(nav.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    }
    expect(screen.getByTestId('index-management-modal')).toBeTruthy();
  });

  it('docks Clone Table and Server Insights as panes', () => {
    render(<UtilitiesView />);
    fireEvent.click(screen.getByTestId('utilities-clone-table'));
    expect(screen.getByTestId('clone-table-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('utilities-system-info'));
    expect(screen.getByTestId('server-insights-modal')).toBeTruthy();
    expect(screen.getByTestId('server-insights-tab-system')).toBeTruthy();
  });

  it('opens Query files without a SQL Editor visit', () => {
    render(<UtilitiesView />);
    fireEvent.click(screen.getByTestId('utilities-query-files'));
    expect(screen.getByTestId('file-query-modal')).toBeTruthy();
    expect(screen.getByTestId('file-imports-panel')).toBeTruthy();
  });
});
