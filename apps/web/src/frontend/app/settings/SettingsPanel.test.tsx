/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';

vi.mock('@/features/auth', () => ({
  fetchAppInfo: vi.fn(async () => ({
    db: { engine: 'sqlite', location: '/tmp/foxschema.db' },
    security: { keyScheme: 'os', emailBound: false, boundEmail: '' },
  })),
}));

vi.mock('@/app/shell/updateToast', () => ({
  runSelfUpdate: vi.fn(),
  toastUpdateCheckResult: vi.fn(),
}));

vi.mock('@/shared/api/updatesApi', () => ({
  checkForUpdates: vi.fn(async () => ({
    current: '0.2.0',
    latest: '0.2.0',
    updateAvailable: false,
  })),
}));

describe('SettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens as a Preferences workspace with tabs', () => {
    render(<SettingsPanel embedded />);
    expect(screen.getByTestId('settings-workspace')).toBeTruthy();
    expect(screen.getByTestId('settings-view').textContent).toMatch(/Preferences/);
    expect(screen.getByTestId('settings-tab-appearance').getAttribute('aria-current')).toBe(
      'page'
    );
    fireEvent.click(screen.getByTestId('settings-tab-database'));
    expect(screen.getByTestId('settings-tab-database').getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByTestId('settings-tab-updates'));
    expect(screen.getByTestId('settings-tab-updates').getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByTestId('settings-tab-security'));
    expect(screen.getByTestId('settings-tab-security').getAttribute('aria-current')).toBe('page');
  });
});
