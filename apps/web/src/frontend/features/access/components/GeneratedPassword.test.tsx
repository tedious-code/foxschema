/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Showing the generated password once, after it has been copied.
 *
 * The point of the feature is that "Copy with generated password" used to hand
 * over SQL containing a credential nobody had seen, so there was no way to tell
 * the new user their password. The point of these tests is that showing it does
 * not quietly weaken the two properties the rest of the design rests on: the
 * SQL preview never contains a real password, and nothing keeps one around.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccessView } from './AccessView';

vi.mock('@/app/store/useSyncStore', () => {
  const state = {
    connections: [
      { id: 'c1', name: 'Demo PG', dialect: 'postgres', database: 'app', schema: 'public' },
      { id: 'c2', name: 'Demo MySQL', dialect: 'mysql', database: 'app' },
    ],
  };
  return { useSyncStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

vi.mock('@/app/store/useSqlEditorStore', () => {
  const state = {
    sessionPasswords: {} as Record<string, string>,
    ensureSchema: vi.fn().mockResolvedValue(undefined),
    schemaCache: { c1: { status: 'ready', tables: [] as [] } },
  };
  return { useSqlEditorStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

const fetchDbAccess = vi.fn();
const fetchSchemaList = vi.fn();
vi.mock('@/shared/api/schemaApi', () => ({
  fetchDbAccess: (...args: unknown[]) => fetchDbAccess(...args),
  fetchSchemaList: (...args: unknown[]) => fetchSchemaList(...args),
}));

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(async (text: string) => {
        written.push(text);
      }),
    },
  });
  fetchDbAccess.mockReset();
  fetchSchemaList.mockReset();
  fetchSchemaList.mockResolvedValue(['public']);
  fetchDbAccess.mockResolvedValue({
    dialect: 'postgres',
    schema: 'public',
    mode: 'native',
    support: { mode: 'native', query: true, grant: true, hint: '' },
    principals: [],
    privileges: [],
  });
});

/** Get as far as an Add-user form with SQL that needs a password. */
async function addUserForm(name = 'report_user') {
  render(<AccessView />);
  fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });
  await waitFor(() => expect(screen.getByTestId('user-add-user')).toBeTruthy());
  fireEvent.click(screen.getByTestId('user-add-user'));
  fireEvent.change(screen.getByTestId('user-name'), { target: { value: name } });
  await waitFor(() => expect(screen.getByTestId('user-copy-with-password')).toBeTruthy());
}

describe('the password is shown after it is copied', () => {
  it('is not on screen until the copy is asked for', async () => {
    await addUserForm();
    expect(screen.queryByTestId('user-generated-password')).toBeNull();
  });

  it('shows the same password that went to the clipboard', async () => {
    await addUserForm();
    fireEvent.click(screen.getByTestId('user-copy-with-password'));

    await waitFor(() => expect(screen.getByTestId('user-generated-password')).toBeTruthy());
    const shown = screen.getByTestId('user-generated-password-value').textContent ?? '';
    expect(shown.length).toBeGreaterThan(8);
    // A password displayed that is not the one in the copied SQL would be worse
    // than none — the reader would record a credential nothing ever set.
    expect(written.at(-1)).toContain(shown);
  });

  it('leaves the preview reading <password>', async () => {
    // The rule the rest of the design rests on: a real password never appears
    // in the statement on screen, only on the clipboard.
    await addUserForm();
    fireEvent.click(screen.getByTestId('user-copy-with-password'));
    await waitFor(() => expect(screen.getByTestId('user-generated-password')).toBeTruthy());

    const preview = screen.getByTestId('user-sql').textContent ?? '';
    const shown = screen.getByTestId('user-generated-password-value').textContent ?? '';
    expect(preview).toContain('<password>');
    expect(preview).not.toContain(shown);
  });

  it('goes away when dismissed', async () => {
    await addUserForm();
    fireEvent.click(screen.getByTestId('user-copy-with-password'));
    await waitFor(() => expect(screen.getByTestId('user-generated-password')).toBeTruthy());

    fireEvent.click(screen.getByTestId('user-generated-password-dismiss'));
    expect(screen.queryByTestId('user-generated-password')).toBeNull();
  });

  it('goes away when the account name changes', async () => {
    // The password belongs to one statement. Leaving it up after the name
    // changes invites recording a credential the new SQL does not set.
    await addUserForm();
    fireEvent.click(screen.getByTestId('user-copy-with-password'));
    await waitFor(() => expect(screen.getByTestId('user-generated-password')).toBeTruthy());

    fireEvent.change(screen.getByTestId('user-name'), { target: { value: 'someone_else' } });
    expect(screen.queryByTestId('user-generated-password')).toBeNull();
  });

  it('goes away when the form is cancelled', async () => {
    await addUserForm();
    fireEvent.click(screen.getByTestId('user-copy-with-password'));
    await waitFor(() => expect(screen.getByTestId('user-generated-password')).toBeTruthy());

    fireEvent.click(screen.getByTestId('user-cancel-action'));
    expect(screen.queryByTestId('user-generated-password')).toBeNull();
  });

  it('generates a different password each time', async () => {
    await addUserForm();
    fireEvent.click(screen.getByTestId('user-copy-with-password'));
    await waitFor(() => expect(screen.getByTestId('user-generated-password')).toBeTruthy());
    const first = screen.getByTestId('user-generated-password-value').textContent;

    fireEvent.click(screen.getByTestId('user-copy-with-password'));
    await waitFor(() =>
      expect(screen.getByTestId('user-generated-password-value').textContent).not.toBe(first)
    );
  });

  it('still shows the password when the clipboard refuses', async () => {
    // NotAllowedError is normal: no permission, or the document is not focused.
    // Before this, the button did nothing at all — no copy, no message, and no
    // password — so the reader had no way to tell it had failed.
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError: Write permission denied')),
      },
    });
    await addUserForm();
    fireEvent.click(screen.getByTestId('user-copy-with-password'));

    await waitFor(() => expect(screen.getByTestId('user-generated-password')).toBeTruthy());
    const shown = screen.getByTestId('user-generated-password-value').textContent ?? '';
    expect(shown.length).toBeGreaterThan(8);
    expect(screen.getByTestId('user-generated-password').textContent).toMatch(/clipboard refused/i);
  });
});

describe('the hint matches what is actually on screen', () => {
  it('points at the button instead of asking for a manual substitution', async () => {
    // With "Copy with generated password" present, telling the reader to
    // replace <password> by hand describes work the button already does — and
    // invites them to think the button did not do it.
    await addUserForm();
    const hint = screen.getByTestId('user-password-hint').textContent ?? '';
    expect(hint).toMatch(/copy with generated password/i);
    expect(hint).not.toMatch(/replace it/i);
  });

  it('still says the password is never stored', async () => {
    // The reassurance is the part that was true in every state; changing the
    // instruction should not have dropped it.
    await addUserForm();
    expect(screen.getByTestId('user-password-hint').textContent).toMatch(/never stores it/i);
  });
});
