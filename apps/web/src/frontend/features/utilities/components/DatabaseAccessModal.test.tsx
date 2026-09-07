/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_ROLE_PERMISSIONS } from '@foxschema/shared';
import { useAuthStore } from '@/app/store/authStore';
import { useSyncStore } from '@/app/store/useSyncStore';

const fetchDbAccess = vi.fn();
const executeSql = vi.fn();
const fetchSchemaList = vi.fn();
const loadSchema = vi.fn();

vi.mock('@/shared/api/schemaApi', () => ({
  fetchDbAccess: (...args: unknown[]) => fetchDbAccess(...args),
  fetchSchemaList: (...args: unknown[]) => fetchSchemaList(...args),
  loadSchema: (...args: unknown[]) => loadSchema(...args),
}));
vi.mock('@/shared/api/sqlApi', () => ({
  executeSql: (...args: unknown[]) => executeSql(...args),
}));

import { DatabaseAccessModal } from './DatabaseAccessModal';

beforeEach(() => {
  fetchDbAccess.mockReset();
  executeSql.mockReset();
  fetchSchemaList.mockReset();
  loadSchema.mockReset();
  fetchSchemaList.mockResolvedValue(['public']);
  loadSchema.mockResolvedValue({
    tables: [
      { name: 'orders', objectType: 'TABLE' },
      { name: 'customers', objectType: 'TABLE' },
      { name: 'v_open', objectType: 'VIEW' },
      { name: 'sp_run', objectType: 'PROCEDURE' },
      { name: 'fn_total', objectType: 'FUNCTION' },
    ],
  });
  fetchDbAccess.mockResolvedValue({
    dialect: 'postgres',
    schema: 'public',
    mode: 'native',
    support: {
      mode: 'native',
      query: true,
      grant: true,
      hint: 'PostgreSQL catalog',
    },
    principals: [
      {
        name: 'analysts',
        kind: 'role',
        canLogin: false,
        memberOf: [],
        members: ['alice'],
      },
      {
        name: 'alice',
        kind: 'user',
        canLogin: true,
        memberOf: ['analysts'],
        members: [],
      },
    ],
    privileges: [
      {
        grantee: 'alice',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectSchema: 'public',
        objectName: 'orders',
        grantable: false,
        grantor: null,
        state: null,
      },
    ],
  });
  executeSql.mockResolvedValue({
    results: [{ ok: true, columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1 }],
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
  useSyncStore.setState({
    connections: [
      {
        id: 'c1',
        name: 'prod',
        dialect: 'postgres',
        schema: 'public',
        database: 'app',
        hasPassword: true,
      },
    ],
  } as never);
});

describe('DatabaseAccessModal', () => {
  it('lists groups and users, shows privileges, and grants via dialect-aware sections', async () => {
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });

    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    expect(screen.getByTestId('db-access-group-role').textContent).toMatch(/analysts/);
    expect(screen.getByTestId('db-access-group-user').textContent).toMatch(/alice/);

    fireEvent.click(screen.getByTestId('db-access-principal-alice'));
    expect(screen.getByTestId('db-access-privileges').textContent).toMatch(/SELECT/);
    expect(screen.getByTestId('db-access-privileges').textContent).toMatch(/public\.orders/);

    expect(screen.getByTestId('db-access-permission-sections')).toBeTruthy();
    expect(screen.getByTestId('db-access-section-general')).toBeTruthy();

    fireEvent.click(screen.getByTestId('db-access-expand-table'));
    await waitFor(() => expect(fetchSchemaList).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('db-access-obj-public-orders')).toBeTruthy());

    fireEvent.click(screen.getByTestId('db-access-edit-orders'));
    await waitFor(() => expect(screen.getByTestId('db-access-object-editor')).toBeTruthy());
    // Held SELECT is pre-selected; Preview uses dialect buildAccessSql.
    fireEvent.click(screen.getByTestId('db-access-preview-sql'));

    await waitFor(() => expect(screen.getByTestId('db-access-sql-modal')).toBeTruthy());
    const preview = screen.getByTestId('db-access-grant-sql').textContent ?? '';
    expect(preview).toMatch(/GRANT/i);
    expect(preview).toMatch(/orders/i);
    expect(preview).toMatch(/alice/i);

    fireEvent.click(screen.getByTestId('db-access-grant'));
    expect(screen.getByTestId('db-access-confirm').textContent).toMatch(/GRANT/i);
    fireEvent.click(screen.getByTestId('db-access-confirm-run'));
    await waitFor(() => expect(executeSql).toHaveBeenCalled());
    const stmts = executeSql.mock.calls[0][1] as string[];
    expect(stmts.join('\n')).toMatch(/GRANT/i);
    expect(stmts.join('\n')).toMatch(/orders/i);
  });
});

describe('DatabaseAccessModal — role membership is not an object privilege', () => {
  /** A principal that both holds a privilege and belongs to a role. */
  function withMembership() {
    fetchDbAccess.mockResolvedValue({
      dialect: 'postgres',
      schema: 'public',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: 'PostgreSQL catalog' },
      principals: [
        { name: 'alice', kind: 'user', canLogin: true, memberOf: ['analysts'], members: [] },
      ],
      privileges: [
        {
          grantee: 'alice',
          privilege: 'SELECT',
          objectType: 'TABLE',
          objectSchema: 'public',
          objectName: 'orders',
          grantable: false,
          grantor: null,
          state: null,
        },
        {
          grantee: 'alice',
          privilege: 'analysts',
          objectType: 'ROLE',
          objectSchema: null,
          objectName: 'analysts',
          grantable: false,
          grantor: null,
          state: null,
        },
      ],
    });
  }

  it('lists the membership under Role memberships, not under privileges', async () => {
    withMembership();
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('db-access-principal-alice'));

    const privileges = screen.getByTestId('db-access-privileges').textContent ?? '';
    const memberships = screen.getByTestId('db-access-memberships').textContent ?? '';

    expect(privileges).toMatch(/SELECT/);
    expect(privileges).toMatch(/public\.orders/);
    expect(privileges).not.toMatch(/analysts/);
    expect(privileges).not.toMatch(/\bROLE\b/);
    expect(privileges).toMatch(/Object privileges \(1\)/);

    expect(memberships).toMatch(/Role memberships \(1\)/);
    expect(memberships).toMatch(/analysts/);
  });

  it('offers object privileges and membership as separate grant kinds', async () => {
    withMembership();
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('db-access-principal-alice'));

    const kind = screen.getByTestId('db-access-grant-kind') as HTMLSelectElement;
    expect([...kind.options].map((o) => o.value)).toEqual(['sections', 'membership']);

    expect(screen.getByTestId('db-access-permission-sections')).toBeTruthy();
    fireEvent.change(kind, { target: { value: 'membership' } });
    expect(screen.queryByTestId('db-access-permission-sections')).toBeNull();
    expect(screen.getByTestId('db-access-grant-name')).toBeTruthy();
  });
});

describe('DatabaseAccessModal — dialect-aware general CREATE', () => {
  it('previews Postgres CREATE ON SCHEMA for general create-object', async () => {
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('db-access-principal-alice'));

    fireEvent.click(screen.getByTestId('db-access-grant-general'));
    await waitFor(() => expect(screen.getByTestId('db-access-general-editor')).toBeTruthy());
    fireEvent.click(screen.getByTestId('db-access-general-preview-sql'));
    await waitFor(() => expect(screen.getByTestId('db-access-sql-modal')).toBeTruthy());
    const sql = screen.getByTestId('db-access-grant-sql').textContent ?? '';
    // Postgres emitter — not a fake "GRANT CREATE TABLE, CREATE VIEW ON SCHEMA".
    expect(sql).toMatch(/CREATE/i);
    expect(sql).toMatch(/SCHEMA/i);
    expect(sql).toMatch(/alice/i);
  });
});
