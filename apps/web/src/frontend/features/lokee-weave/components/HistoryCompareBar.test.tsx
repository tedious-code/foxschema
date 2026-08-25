/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HistoryCompareBar } from './HistoryCompareBar';
import { useLokeeHistoryStore } from '@/features/lokee-weave/store/lokeeHistoryStore';

const DB = {
  id: 'db1',
  dialect: 'postgres',
  host: 'localhost',
  database: 'foxdb',
  schema: 'public',
  versionCount: 2,
  lastSeenAt: '2026-08-11T00:00:00.000Z',
};

beforeEach(() => {
  useLokeeHistoryStore.setState({
    databaseId: 'db1',
    originalVersionId: null,
    targetVersionId: null,
    databases: [DB],
    versions: [
      { id: 'v2', number: 2, name: 'Head' },
      { id: 'v1', number: 1, name: 'Initial' },
    ],
  });
});

describe('HistoryCompareBar', () => {
  it('defaults Original to the previous version and Target to the current database', () => {
    render(<HistoryCompareBar />);
    expect((screen.getByTestId('lokee-original-version') as HTMLSelectElement).value).toBe('v1');
    expect((screen.getByTestId('lokee-target-version') as HTMLSelectElement).value).toBe('');
    expect(screen.getByTestId('lokee-target-version').textContent).toContain('Current database');
    expect(screen.getByTestId('lokee-database-select').textContent).toContain('POSTGRES');
  });

  it('lets the user pick an older Target version', () => {
    render(<HistoryCompareBar />);
    fireEvent.change(screen.getByTestId('lokee-target-version'), { target: { value: 'v1' } });
    expect(useLokeeHistoryStore.getState().targetVersionId).toBe('v1');
    expect((screen.getByTestId('lokee-target-version') as HTMLSelectElement).value).toBe('v1');
  });

  it('swaps Original and Target like Compare', () => {
    render(<HistoryCompareBar />);
    fireEvent.click(screen.getByTestId('lokee-history-swap-btn'));
    expect(useLokeeHistoryStore.getState().originalVersionId).toBe('v2');
    expect(useLokeeHistoryStore.getState().targetVersionId).toBe('v1');
  });
});
