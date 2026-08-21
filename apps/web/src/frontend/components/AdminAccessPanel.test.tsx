/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_META } from '../../shared/permissions';
import { useAuthStore } from '../store/authStore';

const apiAdminListUsers = vi.fn();
const apiAdminRolePermissions = vi.fn();
const apiAdminSetRolePermissions = vi.fn();
const apiAdminSetUserActive = vi.fn();
const apiAdminSetUserPassword = vi.fn();
const apiAdminSetUserRole = vi.fn();

vi.mock('../api/authApi', () => ({
  apiAdminListUsers: (...args: unknown[]) => apiAdminListUsers(...args),
  apiAdminRolePermissions: (...args: unknown[]) => apiAdminRolePermissions(...args),
  apiAdminSetRolePermissions: (...args: unknown[]) => apiAdminSetRolePermissions(...args),
  apiAdminSetUserActive: (...args: unknown[]) => apiAdminSetUserActive(...args),
  apiAdminSetUserPassword: (...args: unknown[]) => apiAdminSetUserPassword(...args),
  apiAdminSetUserRole: (...args: unknown[]) => apiAdminSetUserRole(...args),
}));

import { AdminAccessPanel } from './AdminAccessPanel';

const localUser = {
  id: 'local-id',
  email: 'local@foxschema.app',
  role: 'admin' as const,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  apiAdminListUsers.mockReset();
  apiAdminRolePermissions.mockReset();
  apiAdminSetRolePermissions.mockReset();
  apiAdminSetUserActive.mockReset();
  apiAdminSetUserPassword.mockReset();
  apiAdminSetUserRole.mockReset();

  apiAdminListUsers.mockResolvedValue({ users: [localUser] });
  apiAdminRolePermissions.mockResolvedValue({
    matrix: {
      viewer: [...DEFAULT_ROLE_PERMISSIONS.viewer],
      editor: [...DEFAULT_ROLE_PERMISSIONS.editor],
      owner: [...DEFAULT_ROLE_PERMISSIONS.owner],
      admin: [...DEFAULT_ROLE_PERMISSIONS.admin],
    },
    catalog: PERMISSION_META,
  });
  apiAdminSetRolePermissions.mockImplementation(async (_role: string, permissions: string[]) => [
    ...permissions,
  ]);

  useAuthStore.setState({
    user: {
      id: localUser.id,
      email: localUser.email,
      onboardingCompleted: true,
      role: 'admin',
      permissions: [],
    },
    status: 'ready',
    localSingleUser: true,
    error: null,
    busy: false,
    refreshMe: vi.fn(async () => {}),
  });
});

describe('AdminAccessPanel', () => {
  it('locks role and Active for the local single-user admin', async () => {
    render(<AdminAccessPanel open onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId(`admin-user-role-${localUser.id}`)).toBeTruthy();
    });
    expect(screen.getByTestId('admin-single-user-hint').textContent).toMatch(/single-user/i);
    expect((screen.getByTestId(`admin-user-role-${localUser.id}`) as HTMLSelectElement).disabled).toBe(
      true
    );
    expect((screen.getByTestId(`admin-active-${localUser.id}`) as HTMLInputElement).disabled).toBe(
      true
    );
  });

  it('keeps Save visible and persists checkbox edits for a non-admin role', async () => {
    render(<AdminAccessPanel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('admin-tab-roles')).toBeTruthy());
    fireEvent.click(screen.getByTestId('admin-tab-roles'));

    const save = screen.getByTestId('admin-save-role-perms') as HTMLButtonElement;
    expect(save).toBeTruthy();
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('admin-edit-role-owner'));
    const manageUsers = screen.getByTestId('admin-perm-admin.users') as HTMLInputElement;
    expect(manageUsers.checked).toBe(false);
    fireEvent.click(manageUsers);
    expect(manageUsers.checked).toBe(true);
    expect(screen.getByTestId('admin-unsaved').textContent).toMatch(/unsaved/i);
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(apiAdminSetRolePermissions).toHaveBeenCalledTimes(1));
    const [role, perms] = apiAdminSetRolePermissions.mock.calls[0] as [string, string[]];
    expect(role).toBe('owner');
    expect(perms).toContain('admin.users');
    await waitFor(() => {
      expect(screen.getByTestId('admin-save-status').textContent).toMatch(/saved owner/i);
    });
  });

  it('lets you inspect admin but not edit or save that role', async () => {
    render(<AdminAccessPanel open onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('admin-tab-roles')).toBeTruthy());
    fireEvent.click(screen.getByTestId('admin-tab-roles'));
    fireEvent.click(screen.getByTestId('admin-edit-role-admin'));

    expect((screen.getByTestId('admin-perm-admin.users') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('admin-perm-admin.users') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('admin-save-role-perms') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('admin-roles-hint').textContent).toMatch(/cannot be reduced/i);
  });

  it('opens for a role without admin grants and explains how to get access', async () => {
    useAuthStore.setState({
      user: {
        id: 'u-editor',
        email: 'editor@example.com',
        onboardingCompleted: true,
        role: 'editor',
        permissions: [...DEFAULT_ROLE_PERMISSIONS.editor],
      },
      localSingleUser: false,
    });
    render(<AdminAccessPanel open onClose={() => undefined} />);
    expect(screen.getByTestId('admin-access-panel')).toBeTruthy();
    expect(screen.getByTestId('admin-access-denied').textContent).toMatch(/configure roles/i);
    expect(screen.queryByTestId('admin-tab-users')).toBeNull();
    expect(screen.queryByTestId('admin-tab-roles')).toBeNull();
  });

  it('defaults to Roles when the user can configure roles but not users', async () => {
    useAuthStore.setState({
      user: {
        id: 'u-owner',
        email: 'owner@example.com',
        onboardingCompleted: true,
        role: 'owner',
        permissions: [...DEFAULT_ROLE_PERMISSIONS.owner, 'admin.roles'],
      },
      localSingleUser: false,
    });
    render(<AdminAccessPanel open onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('admin-tab-roles')).toBeTruthy());
    expect(screen.queryByTestId('admin-tab-users')).toBeNull();
    expect(screen.getByTestId('admin-edit-role-editor')).toBeTruthy();
  });
});
