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
const planLokeeRevert = vi.fn();
const executeLokeeRevert = vi.fn();

vi.mock('../../api/lokeeApi', () => ({
  inspectLokeeObject: (...args: unknown[]) => inspectLokeeObject(...args),
  planLokeeRevert: (...args: unknown[]) => planLokeeRevert(...args),
  executeLokeeRevert: (...args: unknown[]) => executeLokeeRevert(...args),
}));

vi.mock('../../store/toastStore', () => ({ toast: vi.fn() }));
vi.mock('../../lib/sessionPasswords', () => ({ getSessionPassword: () => undefined }));

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
  planLokeeRevert.mockReset();
  executeLokeeRevert.mockReset();
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
      columnMutations: [
        {
          objectKey: 'column:CUSTOMER.EMAIL',
          columnName: 'email',
          events: [
            {
              versionId: 'v1',
              versionNumber: 1,
              createdAt: '2026-08-01T00:00:00.000Z',
              source: 'manual',
              operation: 'ADD',
              body: { dataType: 'varchar(100)', name: 'email' },
              reused: false,
            },
            {
              versionId: 'v2',
              versionNumber: 2,
              createdAt: '2026-08-12T00:00:00.000Z',
              source: 'migrate',
              operation: 'MODIFY',
              body: { dataType: 'varchar(255)', name: 'email' },
              previousBody: { dataType: 'varchar(100)' },
              reused: false,
            },
          ],
        },
        {
          objectKey: 'column:CUSTOMER.PHONE',
          columnName: 'phone',
          events: [
            {
              versionId: 'v2',
              versionNumber: 2,
              createdAt: '2026-08-12T00:00:00.000Z',
              source: 'migrate',
              operation: 'ADD',
              body: { dataType: 'varchar(20)', name: 'phone' },
              reused: false,
            },
          ],
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
    expect(screen.getByTestId('lokee-inspector-growth').textContent).toContain('v1');
    expect(screen.getByTestId('lokee-inspector-column-mutations').textContent).toContain('phone');
    expect(screen.getByTestId('lokee-inspector-column-mutations').textContent).toContain(
      'varchar(100) → varchar(255)'
    );
    expect(screen.getByTestId('lokee-inspector-revert-1')).toBeTruthy();
    expect(screen.queryByTestId('lokee-inspector-revert-2')).toBeNull();
  });

  it('does not show table growth on a function', async () => {
    inspectLokeeObject.mockResolvedValue({
      blueprint: {
        focusKey: 'function:FN_ORDER_TOTAL',
        container: {
          key: 'function:FN_ORDER_TOTAL',
          type: 'function',
          name: 'fn_order_total',
          hash: 'f1',
          body: { definition: 'CREATE FUNCTION fn_order_total...' },
          sourceText: 'CREATE OR REPLACE FUNCTION fn_order_total(p_order_id INTEGER)\nRETURNS DECIMAL\n...',
          lineCount: 8,
        },
        object: {
          key: 'function:FN_ORDER_TOTAL',
          type: 'function',
          name: 'fn_order_total',
          hash: 'f1',
          body: { definition: 'CREATE FUNCTION fn_order_total...' },
          sourceText: 'CREATE OR REPLACE FUNCTION fn_order_total(p_order_id INTEGER)\nRETURNS DECIMAL\n...',
          lineCount: 8,
        },
        columns: [],
        indexes: [],
        foreignKeys: [],
        triggers: [],
        primaryKey: null,
      },
      history: [
        {
          versionId: 'v1',
          versionNumber: 1,
          createdAt: '2026-08-12T00:00:00.000Z',
          source: 'manual',
          operation: 'ADD',
          body: {},
          reused: false,
          lineCount: 8,
        },
      ],
      growth: [
        {
          versionId: 'v1',
          versionNumber: 1,
          createdAt: '2026-08-12T00:00:00.000Z',
          columns: 0,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 1,
        },
      ],
      columnMutations: [],
    });
    const selected: SchemaObjectNodeData = {
      versionId: 'v1',
      objectKey: 'function:FN_ORDER_TOTAL',
      name: 'fn_order_total',
      objectType: 'function',
      objectHash: 'f1',
      status: 'added',
      previousHash: null,
    };
    render(<LokeeObjectInspector databaseId="db1" selected={selected} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('lokee-inspector-source')).toBeTruthy());
    expect(screen.getByTestId('lokee-inspector-source').textContent).toMatch(/fn_order_total/i);
    expect(screen.queryByTestId('lokee-inspector-growth')).toBeNull();
    expect(screen.getByTestId('lokee-inspector-history').textContent).toMatch(/v1 · ADD/);
  });

  it('plans a revert when a prior version is selected', async () => {
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
      columnMutations: [],
    });
    planLokeeRevert.mockResolvedValue({
      fromVersion: { id: 'v2', number: 2 },
      toVersion: { id: 'v1', number: 1 },
      alreadyAtTarget: false,
      reversal: {
        risk: 'lossy',
        safeCount: 0,
        lossyCount: 1,
        blockedCount: 0,
        verdicts: [
          {
            key: 'column:CUSTOMER.PHONE',
            risk: 'lossy',
            summary: 'CUSTOMER.PHONE: dropped by the revert',
            dataLoss: 'every value in this column is destroyed',
          },
        ],
      },
      statements: ['ALTER TABLE customer DROP COLUMN phone'],
    });
    const onSelectVersion = vi.fn();
    render(
      <LokeeObjectInspector
        databaseId="db1"
        selected={SELECTED}
        captureConnectionId="c1"
        onClose={() => undefined}
        onSelectVersion={onSelectVersion}
      />
    );
    await waitFor(() => expect(screen.getByTestId('lokee-inspector-revert-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('lokee-inspector-version-1'));
    expect(onSelectVersion).toHaveBeenCalledWith('v1');
    fireEvent.click(screen.getByTestId('lokee-inspector-revert-1'));
    await waitFor(() => expect(screen.getByTestId('lokee-inspector-revert-plan')).toBeTruthy());
    expect(planLokeeRevert).toHaveBeenCalledWith('db1', 'v1');
    expect(screen.getByTestId('lokee-inspector-revert-plan').textContent).toContain('DROP COLUMN');
    expect(screen.getByTestId('lokee-revert-execute')).toBeTruthy();
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
      columnMutations: [],
    });
    const onClose = vi.fn();
    render(<LokeeObjectInspector databaseId="db1" selected={SELECTED} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('lokee-inspector-close')).toBeTruthy());
    fireEvent.click(screen.getByTestId('lokee-inspector-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
