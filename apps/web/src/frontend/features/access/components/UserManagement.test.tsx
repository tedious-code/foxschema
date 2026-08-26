/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The account form generates SQL and never runs it, so what matters here is
 * that what the form says is what the statement says — and that a password
 * typed in reaches the SQL and nothing else.
 */
import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSyncStore } from '@/app/store/useSyncStore';
import { UserManagement } from './UserManagement';

function connections(dialect: string) {
  useSyncStore.setState({
    connections: [
      { id: 'c1', name: 'prod', dialect, schema: 'public', hasPassword: true },
    ],
  } as never);
}

/** Render, choose the credential, and name the account. */
function open(dialect: string, name = 'app_user') {
  connections(dialect);
  render(<UserManagement />);
  fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });
  fireEvent.change(screen.getByTestId('user-name'), { target: { value: name } });
}

const sql = () => screen.getByTestId('user-sql').textContent ?? '';

beforeEach(() => {
  useSyncStore.setState({ connections: [] } as never);
});

describe('UserManagement — password', () => {
  it('emits the placeholder until a password is typed', () => {
    open('postgres');
    expect(sql()).toContain('<password>');

    fireEvent.change(screen.getByTestId('user-password'), { target: { value: 'hunter2' } });
    expect(sql()).toContain('hunter2');
    expect(sql()).not.toContain('<password>');
  });

  it('escapes a password that would otherwise end the literal early', () => {
    open('postgres');
    fireEvent.change(screen.getByTestId('user-password'), {
      target: { value: "'; DROP TABLE users; --" },
    });
    // Doubled, so the quote stays inside the literal.
    expect(sql()).toContain("'''; DROP TABLE users; --'");
  });

  it('refuses an Oracle password it cannot quote, instead of emitting SQL', () => {
    open('oracle');
    fireEvent.change(screen.getByTestId('user-password'), { target: { value: 'we"ird' } });
    expect(screen.queryByTestId('user-sql')).toBeNull();
    expect(screen.getByTestId('user-error').textContent).toMatch(/double quote/i);
  });

  it('warns that the SQL now carries the password in clear text', () => {
    open('postgres');
    fireEvent.change(screen.getByTestId('user-password'), { target: { value: 'hunter2' } });
    expect(screen.getByTestId('user-warnings').textContent).toMatch(/clear text/i);
  });

  it('offers no password field for a role, which has none', () => {
    open('postgres');
    fireEvent.click(screen.getByTestId('user-type-role'));
    expect(screen.queryByTestId('user-password')).toBeNull();
  });

  it('keeps the password out of the DOM as readable text', () => {
    open('postgres');
    const field = screen.getByTestId('user-password') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'hunter2' } });
    expect(field.type).toBe('password');
  });
});

describe('UserManagement — per-dialect options', () => {
  it('shows the options this engine has and not another engine’s', () => {
    open('postgres');
    expect(screen.getByTestId('user-option-superuser')).toBeTruthy();
    // The host part belongs to MySQL, which identifies an account by it.
    expect(screen.queryByTestId('user-option-host')).toBeNull();
  });

  it('shows the MySQL host as part of the account identity', () => {
    open('mysql');
    fireEvent.change(screen.getByTestId('user-option-host'), { target: { value: 'localhost' } });
    expect(sql()).toContain("'app_user'@'localhost'");
    expect(screen.queryByTestId('user-option-superuser')).toBeNull();
  });

  it('puts a chosen postgres attribute into the statement', () => {
    open('postgres');
    fireEvent.click(screen.getByTestId('user-option-superuser'));
    expect(sql()).toContain('SUPERUSER');
    expect(screen.getByTestId('user-warnings').textContent).toMatch(/superuser/i);
  });

  it('adds the clauses SQL Server requires alongside MUST_CHANGE', () => {
    open('sqlserver');
    fireEvent.click(screen.getByTestId('user-option-mustChangePassword'));
    expect(sql()).toContain('MUST_CHANGE');
    expect(sql()).toContain('CHECK_POLICY = ON');
  });

  it('offers no form at all for an engine with no accounts', () => {
    // SQLite has no accounts, so the whole form is replaced by an explanation
    // rather than shown with every option disabled.
    connections('sqlite');
    render(<UserManagement />);
    fireEvent.change(screen.getByTestId('user-connection'), { target: { value: 'c1' } });

    expect(screen.getByTestId('user-unsupported')).toBeTruthy();
    expect(screen.queryByTestId('user-name')).toBeNull();
    expect(screen.queryByTestId('user-option-superuser')).toBeNull();
  });
});
