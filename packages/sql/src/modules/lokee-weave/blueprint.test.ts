/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { TableSchema } from '../../interfaces/schema.interface.js';
import { canonicalizeObject } from './canonical.js';
import {
  assembleBlueprint,
  blueprintChildCounts,
  countSourceLines,
  objectKeyKind,
  objectKeyOwner,
  type StoredWeaveObject,
} from './blueprint.js';

function stored(key: string, type: string, name: string, body: Record<string, unknown> = {}): StoredWeaveObject {
  return { key, type, name, hash: `h:${key}`, body };
}

describe('objectKeyOwner / objectKeyKind', () => {
  it('splits a column address into owner and kind', () => {
    expect(objectKeyKind('column:CUSTOMER.EMAIL')).toBe('column');
    expect(objectKeyOwner('column:CUSTOMER.EMAIL')).toBe('CUSTOMER');
    expect(objectKeyOwner('table:CUSTOMER')).toBe('CUSTOMER');
    expect(objectKeyOwner('index:ORDERS.PK_ORDERS')).toBe('ORDERS');
  });
});

describe('countSourceLines', () => {
  it('counts physical lines, not collapsed whitespace', () => {
    expect(countSourceLines(undefined)).toBe(0);
    expect(countSourceLines('')).toBe(0);
    expect(countSourceLines('select 1')).toBe(1);
    expect(countSourceLines('begin\n  null;\nend')).toBe(3);
    expect(countSourceLines('a\r\nb\r\nc')).toBe(3);
  });
});

describe('assembleBlueprint', () => {
  it('rebuilds columns, indexes and triggers around a table', () => {
    const table: TableSchema = {
      name: 'orders',
      objectType: 'TABLE',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'total', type: 'numeric(10,2)', nullable: true, primaryKey: false },
      ],
      indices: [{ name: 'idx_orders_total', columns: ['total'], unique: false }],
      foreignKeys: [],
      primaryKey: { columns: ['id'] },
      triggers: [{ name: 'trg_orders_audit', timing: 'AFTER', event: 'INSERT', definition: 'begin\n  null;\nend' }],
    };
    const objects = new Map<string, StoredWeaveObject>();
    for (const object of canonicalizeObject(table)) {
      objects.set(object.key, {
        key: object.key,
        type: object.type,
        name: typeof object.body.name === 'string' ? object.body.name : object.key,
        hash: object.key,
        body: object.body,
        sourceText: object.sourceText,
        lineCount: object.sourceText ? countSourceLines(object.sourceText) : null,
      });
    }

    const fromColumn = assembleBlueprint('column:ORDERS.TOTAL', objects);
    expect(fromColumn.container?.key).toBe('table:ORDERS');
    expect(fromColumn.columns.map((c) => c.name).sort()).toEqual(['id', 'total']);
    expect(fromColumn.indexes).toHaveLength(1);
    expect(fromColumn.triggers).toHaveLength(1);
    expect(fromColumn.primaryKey?.body.columns).toEqual(['id']);
    expect(blueprintChildCounts(fromColumn)).toEqual({
      columns: 2,
      indexes: 1,
      foreignKeys: 0,
      triggers: 1,
    });
  });

  it('ignores objects that belong to another table', () => {
    const objects = new Map<string, StoredWeaveObject>([
      ['table:A', stored('table:A', 'table', 'a')],
      ['column:A.ID', stored('column:A.ID', 'column', 'id')],
      ['table:B', stored('table:B', 'table', 'b')],
      ['column:B.ID', stored('column:B.ID', 'column', 'id')],
    ]);
    const blueprint = assembleBlueprint('table:A', objects);
    expect(blueprint.columns).toHaveLength(1);
    expect(blueprint.columns[0]?.key).toBe('column:A.ID');
  });
});
