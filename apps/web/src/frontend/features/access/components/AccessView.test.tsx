/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccessView } from './AccessView';

vi.mock('@/app/store/useSyncStore', () => ({
  useSyncStore: (sel: (s: {
    connections: Array<{ id: string; name: string; dialect: string; database?: string; schema?: string }>;
  }) => unknown) =>
    sel({
      connections: [
        { id: 'c1', name: 'Demo PG', dialect: 'postgres', database: 'app', schema: 'public' },
        { id: 'c2', name: 'Demo MySQL', dialect: 'mysql', database: 'app' },
        { id: 'c3', name: 'Demo Db2', dialect: 'db2', database: 'SAMPLE' },
      ],
    }),
}));

vi.mock('@/app/store/useSqlEditorStore', () => ({
  useSqlEditorStore: (sel: (s: {
    sessionPasswords: Record<string, string>;
    ensureSchema: (id: string) => Promise<void>;
    schemaCache: Record<string, { status: string; tables: [] }>;
  }) => unknown) =>
    sel({
      sessionPasswords: {},
      ensureSchema: vi.fn().mockResolvedValue(undefined),
      schemaCache: {
        c1: { status: 'ready', tables: [] },
        c2: { status: 'ready', tables: [] },
      },
    }),
}));

const fetchDbAccess = vi.fn();
const fetchSchemaList = vi.fn();
vi.mock('@/shared/api/schemaApi', () => ({
  fetchDbAccess: (...args: unknown[]) => fetchDbAccess(...args),
  fetchSchemaList: (...args: unknown[]) => fetchSchemaList(...args),
}));

describe('AccessView — User Management list + Builder handoff', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    fetchDbAccess.mockReset();
    fetchSchemaList.mockReset();
    fetchSchemaList.mockResolvedValue(['public']);
    fetchDbAccess.mockResolvedValue({
      dialect: 'postgres',
      schema: 'public',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: '' },
      principals: [
        {
          name: 'alice',
          kind: 'user',
          canLogin: true,
          memberOf: ['readonly'],
          members: [],
        },
        {
          name: 'readonly',
          kind: 'role',
          canLogin: false,
          memberOf: [],
          members: ['alice'],
        },
      ],
      privileges: [],
    });
  });

  it('shows howto, loads user list, and hands off Add user to Permission Builder', async () => {
    render(<AccessView />);

    expect(screen.getByTestId('user-management')).toBeTruthy();
    expect(screen.getByTestId('user-howto').textContent).toMatch(/How User Management works/);

    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });

    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('user-row-alice')).toBeTruthy());
    expect(screen.getByTestId('user-dialect-coach').textContent).toMatch(/PostgreSQL/i);
    expect(screen.getByTestId('user-row-alice').textContent).toMatch(/readonly/);
    expect(screen.getByTestId('user-row-readonly').textContent).toMatch(/role/i);

    fireEvent.click(screen.getByTestId('user-add-user'));
    fireEvent.change(screen.getByTestId('user-name'), { target: { value: 'analyst' } });

    expect(screen.getByTestId('user-sql').textContent).toMatch(/CREATE ROLE "analyst"/);
    const next = screen.getByTestId('user-grant-next') as HTMLButtonElement;
    expect(next.disabled).toBe(false);

    fireEvent.click(next);

    expect(screen.getByTestId('permission-builder')).toBeTruthy();
    expect(screen.getByTestId('access-draft-banner').textContent).toMatch(/analyst/);
    expect((screen.getByTestId('access-principal-name') as HTMLInputElement).value).toBe('analyst');
    expect((screen.getByTestId('access-connection') as HTMLSelectElement).value).toBe('c1');
  });

  it('previews DROP SQL when dropping a listed user', async () => {
    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(screen.getByTestId('user-row-alice')).toBeTruthy());

    fireEvent.click(screen.getByTestId('user-row-alice'));
    fireEvent.click(screen.getByTestId('user-drop-selected'));

    expect(screen.getByTestId('user-sql').textContent).toMatch(/DROP USER "alice"/);
  });

  it('shows MySQL host when adding a MySQL user', async () => {
    fetchDbAccess.mockResolvedValue({
      dialect: 'mysql',
      schema: '',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: '' },
      principals: [],
      privileges: [],
    });
    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c2' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    expect(screen.getByTestId('user-dialect-coach').textContent).toMatch(/name@host/i);
    fireEvent.click(screen.getByTestId('user-add-user'));
    expect(screen.getByTestId('user-host')).toBeTruthy();
  });

  it('shows Add user (OS) on Db2 with server CONNECT instructions', async () => {
    fetchDbAccess.mockResolvedValue({
      dialect: 'db2',
      schema: '',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: '' },
      principals: [
        {
          name: 'ANALYSTS',
          kind: 'role',
          canLogin: false,
          memberOf: [],
          members: [],
        },
      ],
      privileges: [],
    });
    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c3' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());
    expect(screen.getByTestId('user-dialect-coach').textContent).toMatch(/Db2/i);
    expect(screen.getByTestId('user-add-user').textContent).toMatch(/Add user \(OS\)/);
    expect(screen.getByTestId('user-add-role')).toBeTruthy();
    expect(screen.queryByTestId('user-create-blocked')).toBeNull();

    fireEvent.click(screen.getByTestId('user-add-user'));
    fireEvent.change(screen.getByTestId('user-name'), { target: { value: 'report_user' } });
    fireEvent.change(screen.getByTestId('user-os-role'), { target: { value: 'analysts' } });

    const sql = screen.getByTestId('user-sql').textContent ?? '';
    // Server is the default now: most Db2 installations are a host you have a
    // shell on, not the compose container.
    expect(sql).toMatch(/sudo /);
    expect(sql).not.toMatch(/docker/);
    expect(sql).toMatch(/GRANT CONNECT ON DATABASE TO USER REPORT_USER/);

    // The container form is one selection away.
    fireEvent.change(screen.getByTestId('user-db2-run-mode'), { target: { value: 'docker' } });
    const dockerSql = screen.getByTestId('user-sql').textContent ?? '';
    expect(dockerSql).toMatch(/docker exec/);
    expect(dockerSql).toMatch(/foxschema-db2/);
    fireEvent.change(screen.getByTestId('user-db2-run-mode'), { target: { value: 'server' } });
    expect(sql).toMatch(/connect to SAMPLE/);
    expect(sql).toMatch(/GRANT ROLE ANALYSTS TO USER REPORT_USER/);

    const next = screen.getByTestId('user-grant-next') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect((screen.getByTestId('access-principal-name') as HTMLInputElement).value).toBe('REPORT_USER');
  });

  it('previews OS password and disable steps when editing a Db2 user', async () => {
    fetchDbAccess.mockResolvedValue({
      dialect: 'db2',
      schema: '',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: '' },
      principals: [
        {
          name: 'REPORT_USER',
          kind: 'user',
          canLogin: true,
          memberOf: [],
          members: [],
        },
      ],
      privileges: [],
    });
    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c3' } });
    await waitFor(() => expect(screen.getByTestId('user-row-REPORT_USER')).toBeTruthy());

    fireEvent.click(screen.getByTestId('user-row-REPORT_USER'));
    fireEvent.click(screen.getByTestId('user-edit-selected'));
    expect(screen.getByTestId('user-sql').textContent).toMatch(/chpasswd/);

    fireEvent.click(screen.getByTestId('user-alteration-disable'));
    const disabled = screen.getByTestId('user-sql').textContent ?? '';
    expect(disabled).toMatch(/passwd -l report_user/i);
    expect(disabled).toMatch(/REVOKE CONNECT ON DATABASE FROM USER REPORT_USER/);

    fireEvent.click(screen.getByTestId('user-alteration-enable'));
    expect(screen.getByTestId('user-sql').textContent).toMatch(/passwd -u report_user/i);
  });

  it('hands off Grant access from a selected list row', async () => {
    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(screen.getByTestId('user-row-alice')).toBeTruthy());

    fireEvent.click(screen.getByTestId('user-row-alice'));
    fireEvent.click(screen.getByTestId('user-grant-selected'));

    expect(screen.getByTestId('permission-builder')).toBeTruthy();
    expect(screen.getByTestId('access-draft-banner').textContent).toMatch(/alice/);
    expect((screen.getByTestId('access-principal-name') as HTMLInputElement).value).toBe('alice');
  });

  it('warns on Drop when the account has privileges or role membership', async () => {
    fetchDbAccess.mockResolvedValue({
      dialect: 'postgres',
      schema: 'public',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: '' },
      principals: [
        {
          name: 'alice',
          kind: 'user',
          canLogin: true,
          memberOf: ['readonly'],
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
          state: 'grant',
        },
      ],
    });
    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(screen.getByTestId('user-row-alice')).toBeTruthy());

    fireEvent.click(screen.getByTestId('user-row-alice'));
    fireEvent.click(screen.getByTestId('user-drop-selected'));

    const safety = screen.getByTestId('user-drop-safety');
    expect(safety.textContent).toMatch(/1 recorded privilege/);
    expect(safety.textContent).toMatch(/Member of: readonly/);
    expect(screen.getByTestId('user-sql').textContent).toMatch(/DROP USER "alice"/);
  });

  it('opens Edit on double-click', async () => {
    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(screen.getByTestId('user-row-alice')).toBeTruthy());

    fireEvent.doubleClick(screen.getByTestId('user-row-alice'));
    expect(screen.getByTestId('user-action-form').textContent).toMatch(/Edit alice/i);
    expect(screen.getByTestId('user-sql').textContent).toMatch(/PASSWORD/);
  });
});
