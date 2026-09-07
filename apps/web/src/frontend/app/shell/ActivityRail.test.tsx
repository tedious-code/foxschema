/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_ROLE_PERMISSIONS } from '@foxschema/shared';
import { useAuthStore } from '@/app/store/authStore';
import { useUiStore } from '@/app/store/uiStore';
import { ActivityRail } from './ActivityRail';

describe('ActivityRail', () => {
  it('keeps workspace testids and opens Home from the logo', () => {
    useAuthStore.setState({
      user: {
        id: 'owner',
        email: 'o@x',
        onboardingCompleted: true,
        role: 'owner',
        permissions: [...DEFAULT_ROLE_PERMISSIONS.owner],
      },
      status: 'ready',
      localSingleUser: true,
      error: null,
      busy: false,
      refreshMe: vi.fn(async () => {}),
    });
    useUiStore.setState({ activeView: 'sync' });
    render(<ActivityRail />);
    expect(screen.getByTestId('workspace-switcher')).toBeTruthy();
    expect(screen.getByTestId('view-sync-btn')).toBeTruthy();
    expect(screen.getByTestId('view-sql-editor-btn')).toBeTruthy();
    expect(screen.getByTestId('view-access-btn')).toBeTruthy();
    expect(screen.getByTestId('sync-pane-history-btn')).toBeTruthy();
    fireEvent.click(screen.getByTestId('home-open-btn'));
    expect(useUiStore.getState().activeView).toBe('home');
  });
});
