/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { TableSchema } from '../../interfaces/schema.interface.js';
import { canonicalizeObject, canonicalizeSchema } from './canonical.js';
import { hydrateTableSchemas } from './hydrate.js';

function customer(): TableSchema {
  return {
    name: 'customer',
    objectType: 'TABLE',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'email', type: 'varchar(100)', nullable: true, primaryKey: false },
    ],
    indices: [{ name: 'idx_email', columns: ['email'], unique: true }],
    foreignKeys: [],
    primaryKey: { columns: ['id'] },
    triggers: [
      {
        name: 'trg_audit',
        timing: 'AFTER',
        event: 'INSERT',
        definition: 'begin\n  null;\nend',
      },
    ],
  };
}

describe('hydrateTableSchemas', () => {
  it('round-trips a table with columns, indexes and triggers', () => {
    const original = customer();
    const hydrated = hydrateTableSchemas(canonicalizeObject(original));
    expect(hydrated).toHaveLength(1);
    const table = hydrated[0]!;
    expect(table.name).toBe('customer');
    expect(table.objectType).toBe('TABLE');
    expect(table.columns.map((c) => [c.name, c.type, c.nullable, c.primaryKey])).toEqual([
      ['id', 'integer', false, true],
      ['email', 'varchar(100)', true, false],
    ]);
    expect(table.indices).toEqual([
      expect.objectContaining({ name: 'idx_email', columns: ['email'], unique: true }),
    ]);
    expect(table.primaryKey?.columns).toEqual(['id']);
    expect(table.triggers?.[0]).toEqual(
      expect.objectContaining({ name: 'trg_audit', timing: 'AFTER', event: 'INSERT' })
    );
    expect(table.triggers?.[0]?.definition).toContain('begin');
  });

  it('rebuilds a procedure from its container definition', () => {
    const proc: TableSchema = {
      name: 'charge_order',
      objectType: 'PROCEDURE',
      definition: 'begin\n  null;\nend',
      columns: [],
      indices: [],
      foreignKeys: [],
    };
    const hydrated = hydrateTableSchemas(canonicalizeObject(proc));
    expect(hydrated[0]?.objectType).toBe('PROCEDURE');
    expect(hydrated[0]?.definition).toContain('begin');
  });

  it('drops orphaned columns that have no container', () => {
    const objects = canonicalizeObject(customer()).filter((o) => o.type === 'column');
    expect(hydrateTableSchemas(objects)).toEqual([]);
  });

  it('keeps two tables independent after a whole-schema round trip', () => {
    const other: TableSchema = {
      name: 'orders',
      objectType: 'TABLE',
      columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
      indices: [],
      foreignKeys: [],
      primaryKey: { columns: ['id'] },
    };
    const hydrated = hydrateTableSchemas(canonicalizeSchema([customer(), other]));
    expect(hydrated.map((t) => t.name).sort()).toEqual(['customer', 'orders']);
  });
});
