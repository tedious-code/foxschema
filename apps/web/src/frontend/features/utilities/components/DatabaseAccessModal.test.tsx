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
const fetchSchemaList = vi.fn();
const executeSql = vi.fn();

vi.mock('@/shared/api/schemaApi', () => ({
  fetchDbAccess: (...args: unknown[]) => fetchDbAccess(...args),
  // Feeds the schema suggestions. The panel must still work when it fails, so
  // the tests below leave it resolving an empty list unless they say otherwise.
  fetchSchemaList: (...args: unknown[]) => fetchSchemaList(...args),
}));
vi.mock('@/shared/api/sqlApi', () => ({
  executeSql: (...args: unknown[]) => executeSql(...args),
}));

import { DatabaseAccessModal } from './DatabaseAccessModal';

beforeEach(() => {
  fetchDbAccess.mockReset();
  fetchSchemaList.mockReset();
  fetchSchemaList.mockResolvedValue(['public', 'demo_a']);
  executeSql.mockReset();
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
  executeSql.mockResolvedValue({ results: [{ ok: true, columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1 }] });

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
        hasPassword: true,
      },
    ],
  } as never);
});

describe('DatabaseAccessModal', () => {
  it('lists groups and users, shows privileges, and previews GRANT SQL', async () => {
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });

    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    expect(screen.getByTestId('db-access-group-role').textContent).toMatch(/analysts/);
    expect(screen.getByTestId('db-access-group-user').textContent).toMatch(/alice/);

    fireEvent.click(screen.getByTestId('db-access-principal-alice'));
    expect(screen.getByTestId('db-access-privileges').textContent).toMatch(/SELECT/);
    expect(screen.getByTestId('db-access-privileges').textContent).toMatch(/public\.orders/);

    fireEvent.change(screen.getByTestId('db-access-grant-name'), { target: { value: 'orders' } });
    fireEvent.change(screen.getByTestId('db-access-grant-schema'), { target: { value: 'public' } });
    await waitFor(() => {
      expect(screen.getByTestId('db-access-grant-sql').textContent).toMatch(
        /GRANT SELECT ON TABLE "public"\."orders" TO "alice"/
      );
    });

    fireEvent.click(screen.getByTestId('db-access-grant'));
    expect(screen.getByTestId('db-access-confirm').textContent).toMatch(/GRANT SELECT/);
    fireEvent.click(screen.getByTestId('db-access-confirm-run'));
    await waitFor(() => expect(executeSql).toHaveBeenCalled());
    const stmts = executeSql.mock.calls[0][1] as string[];
    expect(stmts[0]).toMatch(/GRANT SELECT ON TABLE "public"\."orders" TO "alice"/);
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

    // The object privilege stays where it belongs.
    expect(privileges).toMatch(/SELECT/);
    expect(privileges).toMatch(/public\.orders/);

    // The membership does not appear in the privileges table, in any form.
    expect(privileges).not.toMatch(/analysts/);
    expect(privileges).not.toMatch(/\bROLE\b/);
    expect(privileges).toMatch(/Object privileges \(1\)/);

    // It appears in its own section instead.
    expect(memberships).toMatch(/Role memberships \(1\)/);
    expect(memberships).toMatch(/analysts/);
  });

  it('offers privilege and membership as separate things to grant', async () => {
    withMembership();
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('db-access-principal-alice'));

    const kind = screen.getByTestId('db-access-grant-kind') as HTMLSelectElement;
    expect([...kind.options].map((o) => o.value)).toEqual(['privilege', 'membership']);

    // Choosing membership hides the privilege picker, which the builder ignored
    // for role grants anyway.
    expect(screen.queryByTestId('db-access-grant-privilege')).not.toBeNull();
    fireEvent.change(kind, { target: { value: 'membership' } });
    expect(screen.queryByTestId('db-access-grant-privilege')).toBeNull();
    expect(screen.queryByTestId('db-access-grant-object-type')).toBeNull();
  });
});

describe('DatabaseAccessModal — choosing a schema', () => {
  it('suggests the schemas the connection has, and starts at its own', async () => {
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchSchemaList).toHaveBeenCalled());

    const box = screen.getByTestId('db-access-schema') as HTMLInputElement;
    expect(box.value).toBe('public');
    await waitFor(() => {
      const options = [...screen.getByTestId('db-access-schema-options').querySelectorAll('option')];
      expect(options.map((o) => o.getAttribute('value'))).toEqual(['demo_a', 'public']);
    });
  });

  it('reads the schema that was chosen, not the credential’s', async () => {
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('db-access-schema'), { target: { value: 'demo_a' } });
    fireEvent.click(screen.getByTestId('db-access-load'));

    await waitFor(() => {
      const last = fetchDbAccess.mock.calls.at(-1);
      expect(last?.[1]).toMatchObject({ schema: 'demo_a' });
    });
  });

  it('accepts a schema that is not on the list', async () => {
    // The list can be stale, unreadable by this account, or name something the
    // user is about to create.
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('db-access-schema'), { target: { value: 'brand_new' } });
    fireEvent.click(screen.getByTestId('db-access-load'));

    await waitFor(() => {
      expect(fetchDbAccess.mock.calls.at(-1)?.[1]).toMatchObject({ schema: 'brand_new' });
    });
  });

  it('stays usable when the schema list cannot be read', async () => {
    fetchSchemaList.mockRejectedValue(new Error('permission denied for pg_namespace'));
    render(<DatabaseAccessModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('db-access-connection'), { target: { value: 'c1' } });

    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    // Suggestions are a convenience; losing them must not surface as an error
    // or block the panel.
    expect(screen.queryByTestId('db-access-error')).toBeNull();
    expect(screen.getByTestId('db-access-schema')).toBeTruthy();
  });
});
