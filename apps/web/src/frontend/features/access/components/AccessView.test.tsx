/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccessView } from './AccessView';

vi.mock('@/app/store/useSyncStore', () => {
  const state = {
    connections: [
      { id: 'c1', name: 'Demo PG', dialect: 'postgres', database: 'app', schema: 'public' },
      { id: 'c2', name: 'Demo MySQL', dialect: 'mysql', database: 'app' },
      { id: 'c3', name: 'Demo Db2', dialect: 'db2', database: 'SAMPLE' },
    ],
  };
  return {
    useSyncStore: (sel: (s: typeof state) => unknown) => sel(state),
  };
});

vi.mock('@/app/store/useSqlEditorStore', () => {
  const state = {
    sessionPasswords: {} as Record<string, string>,
    ensureSchema: vi.fn().mockResolvedValue(undefined),
    schemaCache: {
      c1: { status: 'ready', tables: [] as [] },
      c2: { status: 'ready', tables: [] as [] },
    },
  };
  return {
    useSqlEditorStore: (sel: (s: typeof state) => unknown) => sel(state),
  };
});

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

  /**
   * A slow catalog read must never repaint the list after the user has moved on.
   *
   * Found by the dialect E2E suite: the Db2 panel listed Oracle's accounts,
   * because Oracle's read was still in flight when the connection changed and
   * its response arrived afterwards. Every button on this screen — Drop, Edit,
   * Grant access — acts on the selected row, so showing one database's accounts
   * under another database's name is the worst failure this component has.
   *
   * Deterministic here, unlike in a browser: the first response is held open
   * until after the second connection has been chosen.
   */
  it('ignores a slow read that lands after the connection changed', async () => {
    const catalog = (dialect: string, principal: string) => ({
      dialect,
      schema: '',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: '' },
      principals: [{ name: principal, kind: 'user', canLogin: true, memberOf: [], members: [] }],
      privileges: [],
    });

    fetchDbAccess.mockReset();
    // c1 answers late, and with a principal that exists only on it. The delay
    // is bounded so the response definitely lands during the test rather than
    // being left pending, which would hang teardown instead of asserting.
    fetchDbAccess.mockImplementation(async (ref: { connectionId: string }) => {
      if (ref.connectionId === 'c1') {
        await new Promise((r) => setTimeout(r, 150));
        return catalog('postgres', 'only_on_postgres');
      }
      return catalog('mysql', 'only_on_mysql');
    });

    render(<AccessView />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());

    // Move on while c1's read is still in flight.
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c2' } });
    await waitFor(() => expect(screen.getByTestId('user-row-only_on_mysql')).toBeTruthy());

    // Wait past c1's delay so its response has certainly arrived, then check
    // that it was discarded rather than painted over the current connection.
    await new Promise((r) => setTimeout(r, 400));

    expect(
      screen.queryByTestId('user-row-only_on_postgres'),
      "the previous connection's accounts must not appear under the new one"
    ).toBeNull();
    expect(screen.getByTestId('user-row-only_on_mysql')).toBeTruthy();
  });
});

describe('AccessView — Permission Builder schema catalog race', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    fetchDbAccess.mockReset();
    fetchSchemaList.mockReset();
    fetchDbAccess.mockResolvedValue({
      dialect: 'mysql',
      schema: '',
      mode: 'native',
      support: { mode: 'native', query: true, grant: true, hint: '' },
      principals: [],
      privileges: [],
    });
  });

  it('keeps the form shut until a connection is chosen', () => {
    // Everything below the picker is an answer about one database: which
    // privileges the engine can express, which schemas exist, what the SQL
    // reads like. The form used to render enabled and empty, so a reader could
    // tick their way through it and reach a preview whose only content was
    // that no connection had been picked.
    render(<AccessView />);
    fireEvent.click(screen.getByTestId('access-tab-builder'));

    expect(screen.getByTestId('access-needs-connection')).toBeTruthy();
    expect(screen.queryByTestId('access-principal-name')).toBeNull();

    fireEvent.change(screen.getByTestId('access-connection'), { target: { value: 'c2' } });

    expect(screen.queryByTestId('access-needs-connection')).toBeNull();
    expect(screen.getByTestId('access-principal-name')).toBeTruthy();
  });

  /**
   * A slow schema list must not drive "every database" after a switch.
   *
   * Principals already discarded superseded responses; schemas did not. On
   * MySQL the schema list *is* the database list, so a Postgres response that
   * landed late turned `public` / `reporting` into GRANT targets — and when
   * those names also exist on the MySQL server, the copied SQL grants on the
   * wrong databases.
   */
  it('ignores a slow schema list that lands after the connection changed', async () => {
    fetchSchemaList.mockImplementation(async (ref: { connectionId: string }) => {
      if (ref.connectionId === 'c1') {
        await new Promise((r) => setTimeout(r, 150));
        return ['public', 'reporting'];
      }
      return ['shop', 'inventory'];
    });

    render(<AccessView />);
    fireEvent.click(screen.getByTestId('access-tab-builder'));

    fireEvent.change(screen.getByTestId('access-connection'), { target: { value: 'c1' } });
    await waitFor(() => expect(fetchSchemaList).toHaveBeenCalled());

    // Move on while Postgres schemas are still in flight.
    fireEvent.change(screen.getByTestId('access-connection'), { target: { value: 'c2' } });
    await waitFor(() =>
      expect(fetchSchemaList.mock.calls.some((c) => c[0]?.connectionId === 'c2')).toBe(true)
    );

    fireEvent.change(screen.getByTestId('access-principal-name'), {
      target: { value: 'report_user' },
    });
    fireEvent.click(screen.getByTestId('access-scope-database'));
    fireEvent.click(screen.getByTestId('access-every-database'));

    // The SQL moved into a dialog so the object grid can have the width; open
    // it before reading. What this test guards is unchanged — which schema
    // names reach the GRANT.
    fireEvent.click(screen.getByTestId('access-preview-sql'));

    await waitFor(() => {
      const sql = screen.getByTestId('access-sql').textContent ?? '';
      expect(sql).toMatch(/shop/);
      expect(sql).toMatch(/inventory/);
    });

    // Wait past the Postgres delay so its schemas have certainly arrived.
    await new Promise((r) => setTimeout(r, 400));

    const sql = screen.getByTestId('access-sql').textContent ?? '';
    expect(sql, 'stale Postgres schema names must not become MySQL GRANT targets').not.toMatch(
      /public|reporting/
    );
    expect(sql).toMatch(/shop/);
    expect(sql).toMatch(/inventory/);
  });
});

describe('AccessView — Permission Diff stale catalog', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    fetchDbAccess.mockReset();
    fetchSchemaList.mockReset();
    fetchSchemaList.mockResolvedValue(['public']);
  });

  // EXECUTE is outside the default read-only desire, so Diff labels it "extra"
  // and the table name appears in the panel — that is how we tell catalogs apart.
  const privilege = (grantee: string, objectName: string): Record<string, unknown> => ({
    grantee,
    privilege: 'EXECUTE',
    objectType: 'TABLE',
    objectSchema: 'public',
    objectName,
    grantable: false,
    grantor: null,
    state: 'grant',
  });

  const catalog = (dialect: string, principal: string, table: string) => ({
    dialect,
    schema: 'public',
    mode: 'native',
    support: { mode: 'native', query: true, grant: true, hint: '' },
    principals: [{ name: principal, kind: 'user', canLogin: true, memberOf: [], members: [] }],
    privileges: [privilege(principal, table)],
  });

  /**
   * Switching connection must drop the previous catalog immediately.
   *
   * Diff builds reconciliation GRANT/REVOKE from `privileges`. Before this
   * fix, switching connection left those rows in place, so the panel kept
   * comparing against database A's grants while naming database B — and the
   * Copy SQL button handed the reader statements shaped by the wrong catalog.
   */
  it('clears reconciliation when the connection changes before a new load', async () => {
    fetchDbAccess.mockResolvedValue(catalog('postgres', 'alice', 'only_on_postgres'));

    render(<AccessView />);
    fireEvent.click(screen.getByTestId('access-tab-diff'));

    fireEvent.change(screen.getByTestId('diff-connection'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByTestId('diff-principal-name'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByTestId('diff-load-catalog'));

    await waitFor(() => expect(screen.getByTestId('diff-summary')).toBeTruthy());
    expect(screen.getByTestId('permission-diff').textContent).toMatch(/only_on_postgres/);

    fireEvent.change(screen.getByTestId('diff-connection'), { target: { value: 'c2' } });

    await waitFor(() => expect(screen.getByTestId('diff-empty')).toBeTruthy());
    expect(screen.getByTestId('diff-empty').textContent).toMatch(/Load the catalog/);
    expect(screen.queryByTestId('diff-summary')).toBeNull();
    expect(screen.getByTestId('permission-diff').textContent).not.toMatch(/only_on_postgres/);
  });

  /**
   * A slow catalog read must not overwrite the current connection's diff.
   *
   * Same race User Management already guards: Oracle answers late, the reader
   * has moved on, and Diff would otherwise emit reconciliation SQL from the
   * superseded privileges under the new connection's dialect.
   */
  it('ignores a slow privilege catalog that lands after the connection changed', async () => {
    fetchDbAccess.mockImplementation(async (ref: { connectionId: string }) => {
      if (ref.connectionId === 'c1') {
        await new Promise((r) => setTimeout(r, 150));
        return catalog('postgres', 'alice', 'only_on_postgres');
      }
      return catalog('mysql', 'alice', 'only_on_mysql');
    });

    render(<AccessView />);
    fireEvent.click(screen.getByTestId('access-tab-diff'));

    fireEvent.change(screen.getByTestId('diff-connection'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByTestId('diff-principal-name'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByTestId('diff-load-catalog'));
    await waitFor(() => expect(fetchDbAccess).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('diff-connection'), { target: { value: 'c2' } });
    // Principal is cleared with the panel state only for privileges; keep alice.
    fireEvent.change(screen.getByTestId('diff-principal-name'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByTestId('diff-load-catalog'));
    await waitFor(() => expect(screen.getByTestId('diff-summary')).toBeTruthy());
    expect(screen.getByTestId('permission-diff').textContent).toMatch(/only_on_mysql/);

    await new Promise((r) => setTimeout(r, 400));

    expect(
      screen.getByTestId('permission-diff').textContent,
      "the previous connection's privileges must not drive reconciliation"
    ).not.toMatch(/only_on_postgres/);
    expect(screen.getByTestId('permission-diff').textContent).toMatch(/only_on_mysql/);
  });
});
