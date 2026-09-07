/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_ROLE_PERMISSIONS } from '@foxschema/shared';
import { useAuthStore } from '@/app/store/authStore';

const fetchDbAccess = vi.fn();
const fetchSchemaList = vi.fn();
const loadSchema = vi.fn();
const runAccessSql = vi.fn();
const setSql = vi.fn();
const ensureConnectionSelected = vi.fn();
const setActiveView = vi.fn();

vi.mock('@/app/store/useSyncStore', () => {
  const state = {
    connections: [
      { id: 'c1', name: 'Demo PG', dialect: 'postgres', database: 'app', schema: 'public' },
    ],
  };
  return {
    useSyncStore: (sel: (s: typeof state) => unknown) => sel(state),
  };
});

vi.mock('@/app/store/useSqlEditorStore', () => {
  const state = {
    sessionPasswords: {} as Record<string, string>,
    setSql: (...args: unknown[]) => setSql(...args),
    ensureConnectionSelected: (...args: unknown[]) => ensureConnectionSelected(...args),
    schemaCache: { c1: { status: 'ready', tables: [] as [] } },
    ensureSchema: vi.fn(),
  };
  return {
    useSqlEditorStore: (sel: (s: typeof state) => unknown) => sel(state),
  };
});

vi.mock('@/app/store/uiStore', () => ({
  useUiStore: (sel: (s: { setActiveView: typeof setActiveView }) => unknown) =>
    sel({ setActiveView }),
}));

vi.mock('@/shared/api/schemaApi', () => ({
  fetchDbAccess: (...args: unknown[]) => fetchDbAccess(...args),
  fetchSchemaList: (...args: unknown[]) => fetchSchemaList(...args),
  loadSchema: (...args: unknown[]) => loadSchema(...args),
}));

vi.mock('@/shared/api/accessSql', () => ({
  runAccessSql: (...args: unknown[]) => runAccessSql(...args),
}));

import { AccessPermissionPanel } from './AccessPermissionPanel';

const catalog = {
  dialect: 'postgres',
  schema: 'public',
  mode: 'native' as const,
  support: { mode: 'native', query: true, grant: true, hint: 'PostgreSQL catalog' },
  principals: [
    {
      name: 'alice',
      kind: 'user' as const,
      canLogin: true,
      memberOf: ['readonly'],
      members: [],
    },
    {
      name: 'readonly',
      kind: 'role' as const,
      canLogin: false,
      memberOf: [],
      members: ['alice'],
    },
  ],
  privileges: [
    {
      grantee: 'alice',
      privilege: 'SELECT',
      objectType: 'TABLE' as const,
      objectSchema: 'public',
      objectName: 'orders',
      grantable: false,
      grantor: null,
      state: 'grant' as const,
    },
  ],
};

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  fetchDbAccess.mockReset();
  fetchSchemaList.mockReset();
  loadSchema.mockReset();
  runAccessSql.mockReset();
  setSql.mockReset();
  ensureConnectionSelected.mockReset();
  setActiveView.mockReset();
  fetchDbAccess.mockResolvedValue(catalog);
  fetchSchemaList.mockResolvedValue(['public']);
  loadSchema.mockResolvedValue({
    tables: [{ name: 'orders', objectType: 'TABLE' }],
  });
  useAuthStore.setState({
    user: {
      id: 'owner',
      email: 'owner@example.com',
      onboardingCompleted: true,
      role: 'owner',
      permissions: [...DEFAULT_ROLE_PERMISSIONS.owner],
    },
    status: 'ready',
    localSingleUser: false,
    error: null,
    busy: false,
    refreshMe: vi.fn(async () => {}),
  });
});

describe('AccessPermissionPanel — one session', () => {
  it('loads a principal tree and Account / Grants / Effective on one catalog', async () => {
    render(<AccessPermissionPanel />);
    fireEvent.change(screen.getByTestId('access-permission-connection'), {
      target: { value: 'c1' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('access-permission-principal').textContent).toMatch(/alice/)
    );
    expect(screen.getByTestId('access-permission-principal').textContent).toMatch(/readonly/);
    expect(fetchDbAccess).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('access-permission-row-alice'));
    fireEvent.click(screen.getByTestId('access-permission-stage-account'));
    expect(screen.getByTestId('access-permission-account-kind').textContent).toMatch(/user/i);
    expect(screen.getByTestId('access-permission-account-login').textContent).toMatch(/Can log in/);
    expect(screen.getByTestId('access-permission-account-memberof').textContent).toMatch(/readonly/);

    fireEvent.click(screen.getByTestId('access-permission-row-readonly'));
    expect(screen.getByTestId('access-permission-account-members').textContent).toMatch(/alice/);

    fireEvent.click(screen.getByTestId('access-permission-stage-grants'));
    expect(screen.getByTestId('db-access-permission-sections')).toBeTruthy();

    fireEvent.click(screen.getByTestId('access-permission-stage-effective'));
    await waitFor(() => expect(screen.getByTestId('permission-inspector')).toBeTruthy());
    expect(screen.queryByTestId('inspector-load')).toBeNull();
    expect(fetchDbAccess).toHaveBeenCalledTimes(1);
  });

  it('copies GRANT SQL instead of executing it', async () => {
    render(<AccessPermissionPanel />);
    fireEvent.change(screen.getByTestId('access-permission-connection'), {
      target: { value: 'c1' },
    });
    await waitFor(() => expect(screen.getByTestId('access-permission-row-alice')).toBeTruthy());
    fireEvent.click(screen.getByTestId('access-permission-row-alice'));

    fireEvent.click(screen.getByTestId('db-access-expand-table'));
    await waitFor(() => expect(screen.getByTestId('db-access-obj-public-orders')).toBeTruthy());
    fireEvent.click(screen.getByTestId('db-access-edit-orders'));
    await waitFor(() => expect(screen.getByTestId('db-access-object-editor')).toBeTruthy());
    fireEvent.click(screen.getByTestId('db-access-preview-sql'));
    await waitFor(() => expect(screen.getByTestId('db-access-sql-modal')).toBeTruthy());
    expect(screen.getByTestId('db-access-grant').textContent).toMatch(/Use this SQL/);
    fireEvent.click(screen.getByTestId('db-access-grant'));

    await waitFor(() => expect(screen.getByTestId('access-permission-confirm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('access-permission-confirm-run'));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringMatching(/GRANT/i))
    );
    expect(runAccessSql).not.toHaveBeenCalled();
    expect(screen.getByTestId('access-permission-status').textContent).toMatch(/Copied/);
  });

  it('opens generated SQL in the SQL Editor without executing', async () => {
    render(<AccessPermissionPanel />);
    fireEvent.change(screen.getByTestId('access-permission-connection'), {
      target: { value: 'c1' },
    });
    await waitFor(() => expect(screen.getByTestId('access-permission-row-alice')).toBeTruthy());
    fireEvent.click(screen.getByTestId('access-permission-row-alice'));

    fireEvent.click(screen.getByTestId('db-access-expand-table'));
    await waitFor(() => expect(screen.getByTestId('db-access-obj-public-orders')).toBeTruthy());
    fireEvent.click(screen.getByTestId('db-access-edit-orders'));
    await waitFor(() => expect(screen.getByTestId('db-access-object-editor')).toBeTruthy());
    fireEvent.click(screen.getByTestId('db-access-preview-sql'));
    await waitFor(() => expect(screen.getByTestId('db-access-sql-modal')).toBeTruthy());
    fireEvent.click(screen.getByTestId('db-access-grant'));
    await waitFor(() => expect(screen.getByTestId('access-permission-open-sql')).toBeTruthy());
    fireEvent.click(screen.getByTestId('access-permission-open-sql'));

    expect(setSql).toHaveBeenCalledWith(expect.stringMatching(/GRANT/i));
    expect(ensureConnectionSelected).toHaveBeenCalledWith('c1');
    expect(setActiveView).toHaveBeenCalledWith('sqlEditor');
    expect(runAccessSql).not.toHaveBeenCalled();
  });
});
