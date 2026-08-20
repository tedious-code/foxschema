/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TableIndexSizeTree } from './TableIndexSizeTree';
import type { ObjectSizeRow } from '@foxschema/sql';

const rows: ObjectSizeRow[] = [
  {
    schemaName: 'public',
    objectName: 'customers',
    objectType: 'table',
    tableName: 'customers',
    totalBytes: 12_288,
    dataBytes: 8_192,
    indexBytes: 4_096,
    rowCount: 50,
  },
  {
    schemaName: 'public',
    objectName: 'idx_email',
    objectType: 'index',
    tableName: 'customers',
    totalBytes: 4_096,
    dataBytes: null,
    indexBytes: 4_096,
    rowCount: 50,
  },
];

describe('TableIndexSizeTree', () => {
  it('shows table totals and expands indexes on row click', () => {
    render(<TableIndexSizeTree rows={rows} filter="" />);

    expect(screen.getByTestId('server-insights-size-rows-customers').textContent).toBe('50');
    expect(screen.getByTestId('server-insights-size-data-customers').textContent).toMatch(/KB|B/);
    expect(screen.getByTestId('server-insights-size-index-customers').textContent).toMatch(/KB|B/);
    expect(screen.queryByTestId('server-insights-size-index-row-customers-idx_email')).toBeNull();

    fireEvent.click(screen.getByTestId('server-insights-size-group-customers'));

    expect(screen.getByTestId('server-insights-size-group-customers').getAttribute('data-expanded')).toBe(
      'true'
    );
    expect(screen.getByTestId('server-insights-size-index-row-customers-idx_email').textContent).toContain(
      'idx_email'
    );
    expect(screen.getByTestId('server-insights-size-index-row-customers-idx_email').textContent).toContain(
      '50'
    );
  });
});
