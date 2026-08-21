/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_ROLE_PERMISSIONS } from '../../shared/permissions';
import { useAuthStore } from '../store/authStore';

vi.mock('../api/updatesApi', () => ({
  checkForUpdates: vi.fn(async () => null),
}));
vi.mock('../lib/updateToast', () => ({
  maybeToastUpdateAvailable: vi.fn(),
}));
vi.mock('./AdminAccessPanel', () => ({
  AdminAccessPanel: ({ open }: { open: boolean }) =>
    open ? <div data-testid="admin-access-panel">Access control</div> : null,
}));
vi.mock('./SettingsPanel', () => ({
  SettingsPanel: () => null,
}));

import { ProfileMenu } from './ProfileMenu';

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 'local',
      email: 'local@foxschema.app',
      onboardingCompleted: true,
      role: 'admin',
      permissions: [],
    },
    status: 'ready',
    localSingleUser: true,
    error: null,
    busy: false,
  });
});

describe('ProfileMenu', () => {
  it('opens Access control from the avatar menu for the local admin', () => {
    render(<ProfileMenu />);
    fireEvent.click(screen.getByText('local@foxschema.app'));
    fireEvent.click(screen.getByTestId('profile-access-control'));
    expect(screen.getByTestId('admin-access-panel')).toBeTruthy();
  });

  it('still offers Access control when the signed-in role is editor', () => {
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
    render(<ProfileMenu />);
    fireEvent.click(screen.getByText('editor@example.com'));
    expect(screen.getByTestId('profile-access-control')).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-access-control'));
    expect(screen.getByTestId('admin-access-panel')).toBeTruthy();
  });
});
