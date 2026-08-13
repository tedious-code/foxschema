/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SchemaObjectNodeData } from './graphTypes';

const inspectLokeeObject = vi.fn();

vi.mock('../../api/lokeeApi', () => ({
  inspectLokeeObject: (...args: unknown[]) => inspectLokeeObject(...args),
}));

import { LokeeObjectInspector } from './LokeeObjectInspector';

const SELECTED: SchemaObjectNodeData = {
  versionId: 'v2',
  objectKey: 'table:CUSTOMER',
  name: 'customer',
  objectType: 'table',
  objectHash: 'abc123',
  status: 'modified',
  previousHash: null,
};

beforeEach(() => {
  inspectLokeeObject.mockReset();
});

describe('LokeeObjectInspector', () => {
  it('renders columns, indexes, triggers and a column type timeline', async () => {
    inspectLokeeObject.mockResolvedValue({
      blueprint: {
        focusKey: 'table:CUSTOMER',
        container: {
          key: 'table:CUSTOMER',
          type: 'table',
          name: 'customer',
          hash: 't1',
          body: { name: 'customer' },
        },
        object: {
          key: 'table:CUSTOMER',
          type: 'table',
          name: 'customer',
          hash: 't1',
          body: { name: 'customer' },
        },
        columns: [
          {
            key: 'column:CUSTOMER.EMAIL',
            type: 'column',
            name: 'email',
            hash: 'c1',
            body: { dataType: 'varchar(255)', nullable: true },
          },
        ],
        indexes: [
          {
            key: 'index:CUSTOMER.IDX',
            type: 'index',
            name: 'idx_email',
            hash: 'i1',
            body: { columns: ['email'], unique: true },
          },
        ],
        foreignKeys: [],
        triggers: [
          {
            key: 'trigger:CUSTOMER.TRG',
            type: 'trigger',
            name: 'trg_audit',
            hash: 'g1',
            body: { timing: 'AFTER', event: 'INSERT' },
            lineCount: 4,
          },
        ],
        primaryKey: {
          key: 'primary_key:CUSTOMER',
          type: 'primary_key',
          name: 'pk',
          hash: 'p1',
          body: { columns: ['id'] },
        },
      },
      history: [
        {
          versionId: 'v1',
          versionNumber: 1,
          createdAt: '2026-08-01T00:00:00.000Z',
          source: 'manual',
          operation: 'ADD',
          body: { dataType: 'varchar(100)' },
          reused: false,
        },
        {
          versionId: 'v2',
          versionNumber: 2,
          createdAt: '2026-08-12T00:00:00.000Z',
          source: 'migrate',
          operation: 'MODIFY',
          body: { dataType: 'varchar(255)' },
          previousBody: { dataType: 'varchar(100)' },
          reused: false,
        },
      ],
      growth: [
        {
          versionId: 'v1',
          versionNumber: 1,
          createdAt: '2026-08-01T00:00:00.000Z',
          columns: 2,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 3,
        },
        {
          versionId: 'v2',
          versionNumber: 2,
          createdAt: '2026-08-12T00:00:00.000Z',
          columns: 3,
          indexes: 1,
          foreignKeys: 0,
          triggers: 1,
          objects: 6,
        },
      ],
    });

    render(
      <LokeeObjectInspector databaseId="db1" selected={SELECTED} onClose={() => undefined} />
    );

    await waitFor(() => expect(screen.getByTestId('lokee-inspector-blueprint')).toBeTruthy());
    expect(screen.getByTestId('lokee-inspector-columns').textContent).toContain('email');
    expect(screen.getByTestId('lokee-inspector-indexes').textContent).toContain('idx_email');
    expect(screen.getByTestId('lokee-inspector-triggers').textContent).toContain('trg_audit');
    expect(screen.getByTestId('lokee-inspector-history').textContent).toContain('varchar(100) → varchar(255)');
    expect(screen.getByTestId('lokee-inspector-growth').textContent).toContain('3 cols');
  });

  it('closes from the header button', async () => {
    inspectLokeeObject.mockResolvedValue({
      blueprint: {
        focusKey: 'table:CUSTOMER',
        container: null,
        object: null,
        columns: [],
        indexes: [],
        foreignKeys: [],
        triggers: [],
        primaryKey: null,
      },
      history: [],
      growth: [],
    });
    const onClose = vi.fn();
    render(<LokeeObjectInspector databaseId="db1" selected={SELECTED} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('lokee-inspector-close')).toBeTruthy());
    fireEvent.click(screen.getByTestId('lokee-inspector-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
