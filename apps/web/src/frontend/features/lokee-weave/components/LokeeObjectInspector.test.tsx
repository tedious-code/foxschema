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

vi.mock('@/features/lokee-weave/api/lokeeApi', () => ({
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
  it('renders updated columns with type/constraint subtitles and a GitHub script diff', async () => {
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
          {
            key: 'column:CUSTOMER.PHONE',
            type: 'column',
            name: 'phone',
            hash: 'c2',
            body: { dataType: 'varchar(20)', nullable: true },
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
      // The server compares this object's stored state against the previous
      // version and hands back a TableDiff, so the inspector can render the
      // very component Compare Schema does.
      diff: {
        tableName: 'CUSTOMER',
        objectType: 'TABLE',
        status: 'MODIFIED',
        columnDiffs: [
          { name: 'id', status: 'UNCHANGED', source: { type: 'integer', nullable: false, primaryKey: true }, target: { type: 'integer', nullable: false, primaryKey: true } },
          {
            name: 'email',
            status: 'MODIFIED',
            source: { type: 'varchar(255)', nullable: true },
            target: { type: 'varchar(100)', nullable: true },
          },
          { name: 'phone', status: 'ADDED', source: { type: 'varchar(20)', nullable: true } },
        ],
        indexDiffs: [
          { name: 'IDX_EMAIL', status: 'ADDED', source: { columns: ['email'], unique: true } },
        ],
        foreignKeyDiffs: [],
        triggerDiffs: [
          {
            name: 'TRG_AUDIT',
            status: 'ADDED',
            source: { name: 'trg_audit', timing: 'AFTER', event: 'INSERT' },
          },
        ],
        sourceTable: { primaryKey: { name: 'pk_customer', columns: ['id'] } },
        targetTable: { primaryKey: { name: 'pk_customer', columns: ['id'] } },
      },
      script: `CREATE TABLE customer (
  id integer PRIMARY KEY,
  email varchar(255),
  phone varchar(20)
);`,
      previousScript: `CREATE TABLE customer (
  id integer PRIMARY KEY,
  email varchar(100)
);`,
    });

    render(
      <LokeeObjectInspector databaseId="db1" selected={SELECTED} onClose={() => undefined} />
    );

    await waitFor(() => expect(screen.getByTestId('lokee-inspector-blueprint')).toBeTruthy());

    // The blueprint is `SchemaBlueprint` — the same tables Compare Schema
    // renders. Old and new state are separate cells with an operation badge,
    // not a hand-written "a → b" line that only history ever produced.
    const columns = screen.getByTestId('blueprint-columns').textContent ?? '';
    expect(columns).toContain('email');
    expect(columns).toContain('varchar(255)');
    expect(columns).toContain('varchar(100)');
    expect(columns).toContain('ALTER TYPE');
    expect(columns).toContain('ADD COLUMN');
    // Indexes were stored but never surfaced by the old bespoke panel.
    expect(screen.getByTestId('blueprint-indexes').textContent).toContain('IDX_EMAIL');
    expect(screen.getByTestId('blueprint-primary-key').textContent).toContain('pk_customer');
    expect(screen.getByTestId('blueprint-triggers').textContent).toContain('TRG_AUDIT');
    expect(screen.getByTestId('lokee-inspector-history').textContent).toContain('varchar(100) → varchar(255)');
    expect(screen.getByTestId('lokee-inspector-growth').textContent).toContain('3 cols');
    expect(screen.getByTestId('lokee-inspector-growth').textContent).not.toMatch(/idx/i);
    expect(screen.getByTestId('lokee-inspector-growth').textContent).toContain('v1');
    expect(screen.getByTestId('lokee-inspector-column-mutations').textContent).toContain('phone');
    expect(screen.getByTestId('lokee-inspector-column-mutations').textContent).toContain(
      'varchar(100) → varchar(255)'
    );
    expect(screen.getByTestId('lokee-inspector-script-diff').textContent).toMatch(/varchar\(255\)/);
    expect(screen.getByTestId('lokee-inspector-script-diff').textContent).toMatch(/\+/);
    // Reverting is the compare modal's job — it can scope the revert to chosen
    // objects, which a per-row button here never could.
    expect(screen.queryByTestId('lokee-inspector-revert-1')).toBeNull();
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

  it('declares its load state so callers need not read the loading copy', async () => {
    // The e2e page object waits on [data-state="ready"] before reading any
    // section. Losing this attribute would not fail a render test — it would
    // hang the browser suite on a timeout — so assert the contract here.
    let resolve!: (value: unknown) => void;
    inspectLokeeObject.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = render(
      <LokeeObjectInspector databaseId="db1" selected={SELECTED} onClose={() => undefined} />
    );
    const aside = container.querySelector('[data-testid="lokee-object-inspector"]')!;
    expect(aside.getAttribute('data-state')).toBe('loading');

    resolve({
      blueprint: {
        focusKey: 'table:CUSTOMERS',
        container: { key: 'table:CUSTOMERS', type: 'table', name: 'customers', hash: 'h1', body: {} },
        object: { key: 'table:CUSTOMERS', type: 'table', name: 'customers', hash: 'h1', body: {} },
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

    await waitFor(() => expect(aside.getAttribute('data-state')).toBe('ready'));
    // Payload-derived, so it changes only once *this* object's fetch lands —
    // `selected.name` updates synchronously on click and proves nothing.
    expect(aside.getAttribute('data-object-key')).toBe('table:CUSTOMERS');
  });

  it('folds the versions that left the object alone, and opens them on demand', async () => {
    // The case the roadmap exists for: a long history in which this table moved
    // twice. Printing fifteen rows to show two changes is what made it
    // unreadable.
    inspectLokeeObject.mockResolvedValue({
      blueprint: {
        focusKey: 'table:CUSTOMER',
        container: { key: 'table:CUSTOMER', type: 'table', name: 'customer', hash: 'h1', body: {} },
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
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: true,
        },
        {
          versionId: 'v2',
          versionNumber: 2,
          createdAt: '2026-08-02T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v3',
          versionNumber: 3,
          createdAt: '2026-08-03T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v4',
          versionNumber: 4,
          createdAt: '2026-08-04T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v5',
          versionNumber: 5,
          createdAt: '2026-08-05T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v6',
          versionNumber: 6,
          createdAt: '2026-08-06T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v7',
          versionNumber: 7,
          createdAt: '2026-08-07T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v8',
          versionNumber: 8,
          createdAt: '2026-08-08T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v9',
          versionNumber: 9,
          createdAt: '2026-08-09T00:00:00.000Z',
          columns: 3,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 4,
          changed: false,
        },
        {
          versionId: 'v10',
          versionNumber: 10,
          createdAt: '2026-08-10T00:00:00.000Z',
          columns: 4,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 5,
          changed: true,
        },
        {
          versionId: 'v11',
          versionNumber: 11,
          createdAt: '2026-08-11T00:00:00.000Z',
          columns: 4,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 5,
          changed: false,
        },
        {
          versionId: 'v12',
          versionNumber: 12,
          createdAt: '2026-08-12T00:00:00.000Z',
          columns: 4,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 5,
          changed: false,
        },
        {
          versionId: 'v13',
          versionNumber: 13,
          createdAt: '2026-08-13T00:00:00.000Z',
          columns: 4,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 5,
          changed: false,
        },
        {
          versionId: 'v14',
          versionNumber: 14,
          createdAt: '2026-08-14T00:00:00.000Z',
          columns: 4,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 5,
          changed: false,
        },
        {
          versionId: 'v15',
          versionNumber: 15,
          createdAt: '2026-08-15T00:00:00.000Z',
          columns: 4,
          indexes: 0,
          foreignKeys: 0,
          triggers: 0,
          objects: 5,
          changed: false,
        },
      ],
      columnMutations: [],
    });
    const onSelectVersion = vi.fn();
    render(
      <LokeeObjectInspector
        databaseId="db1"
        selected={{ ...SELECTED, versionId: 'v15' }}
        onClose={() => undefined}
        onSelectVersion={onSelectVersion}
      />
    );

    await waitFor(() => expect(screen.getByTestId('lokee-inspector-growth')).toBeTruthy());
    // Shown: the two versions that changed it, plus the head.
    expect(screen.getByTestId('lokee-inspector-version-1')).toBeTruthy();
    expect(screen.getByTestId('lokee-inspector-version-10')).toBeTruthy();
    expect(screen.getByTestId('lokee-inspector-version-15')).toBeTruthy();
    // Folded: everything in between, and the count says how much.
    expect(screen.queryByTestId('lokee-inspector-version-5')).toBeNull();
    expect(screen.getByTestId('lokee-roadmap-gap-2-9').textContent).toContain('8 versions');
    expect(screen.getByTestId('lokee-roadmap-gap-11-14')).toBeTruthy();

    // Growth is stated as a delta, measured against the real previous version
    // rather than the previous visible row.
    expect(screen.getByTestId('lokee-inspector-version-10').textContent).toContain('+1');

    // One gap opens without disturbing the other.
    fireEvent.click(screen.getByTestId('lokee-roadmap-gap-2-9'));
    await waitFor(() => expect(screen.getByTestId('lokee-inspector-version-5')).toBeTruthy());
    expect(screen.getByTestId('lokee-roadmap-gap-11-14')).toBeTruthy();

    // And the whole history is one click away.
    fireEvent.click(screen.getByTestId('lokee-roadmap-toggle-all'));
    await waitFor(() => expect(screen.getByTestId('lokee-inspector-version-12')).toBeTruthy());
    expect(screen.queryByTestId('lokee-roadmap-gap-11-14')).toBeNull();

    fireEvent.click(screen.getByTestId('lokee-inspector-version-1'));
    expect(onSelectVersion).toHaveBeenCalledWith('v1');
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
