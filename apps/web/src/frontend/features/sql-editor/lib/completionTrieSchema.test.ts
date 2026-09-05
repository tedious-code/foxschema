/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tables indexed by the schema they belong to.
 *
 * `/schema/load` fetches one schema per connection and the names come back
 * bare, so nothing in the bundle could answer "what is in demo_a?" — the dot
 * handler treated everything before a dot as a table and offered its columns,
 * and a schema has none. The tables were already loaded; there was just no way
 * to ask for them by schema.
 */
import { describe, expect, it } from 'vitest';
import { buildSchemaTries, trieCollect } from './completionTrie';

const source = (over: Partial<Parameters<typeof buildSchemaTries>[0][number]> = {}) => ({
  connectionId: 'c1',
  schema: 'demo_a',
  tables: [
    { name: 'orders', objectType: 'TABLE', columns: [{ name: 'id' }] },
    { name: 'order_items', objectType: 'TABLE', columns: [{ name: 'qty' }] },
    { name: 'customers', objectType: 'TABLE', columns: [{ name: 'email' }] },
  ],
  ...over,
});

describe('tables are reachable by their schema', () => {
  it('indexes the connection’s own schema, whose names arrive bare', () => {
    const { tablesBySchema } = buildSchemaTries([source()]);
    expect(trieCollect(tablesBySchema.get('demo_a')!, '').sort()).toEqual([
      'customers',
      'order_items',
      'orders',
    ]);
  });

  it('filters by what has been typed after the dot', () => {
    const { tablesBySchema } = buildSchemaTries([source()]);
    expect(trieCollect(tablesBySchema.get('demo_a')!, 'order').sort()).toEqual([
      'order_items',
      'orders',
    ]);
  });

  it('matches the schema case-insensitively', () => {
    const { tablesBySchema } = buildSchemaTries([source({ schema: 'DEMO_A' })]);
    expect(tablesBySchema.has('demo_a')).toBe(true);
  });

  it('files a qualified name under its own schema, not the connection’s', () => {
    // Doing both made `demo_a.` offer `sales.invoices`, and accepting it
    // inserted `demo_a.sales.invoices` — a name for a table that is not there.
    const { tablesBySchema } = buildSchemaTries([
      source({
        schema: 'demo_a',
        tables: [{ name: 'sales.invoices', objectType: 'TABLE', columns: [] }],
      }),
    ]);
    expect(trieCollect(tablesBySchema.get('sales')!, '')).toEqual(['invoices']);
    expect(trieCollect(tablesBySchema.get('demo_a')!, '')).toEqual([]);
  });

  it('also reads a schema off a qualified table name', () => {
    // Some dialects and some rows carry `schema.table` in the name itself.
    const { tablesBySchema } = buildSchemaTries([
      source({
        schema: undefined,
        tables: [{ name: 'sales.invoices', objectType: 'TABLE', columns: [{ name: 'id' }] }],
      }),
    ]);
    expect(trieCollect(tablesBySchema.get('sales')!, '')).toEqual(['invoices']);
  });

  it('leaves a connection with no schema name out rather than inventing one', () => {
    const { tablesBySchema } = buildSchemaTries([source({ schema: '' })]);
    expect(tablesBySchema.size).toBe(0);
  });

  it('merges two connections that share a schema name', () => {
    const { tablesBySchema } = buildSchemaTries([
      source(),
      { connectionId: 'c2', schema: 'demo_a', tables: [{ name: 'shipments', objectType: 'TABLE', columns: [] }] },
    ]);
    expect(trieCollect(tablesBySchema.get('demo_a')!, '')).toContain('shipments');
    expect(trieCollect(tablesBySchema.get('demo_a')!, '')).toContain('orders');
  });

  it('skips objects that are not tables or views, but still knows the schema', () => {
    // Knowing the schema exists is what lets the editor say "no tables here"
    // instead of "load a schema" to someone already looking at one.
    const { tablesBySchema } = buildSchemaTries([
      source({ tables: [{ name: 'some_role', objectType: 'ROLE', columns: [] }] }),
    ]);
    expect(tablesBySchema.has('demo_a')).toBe(true);
    expect(trieCollect(tablesBySchema.get('demo_a')!, '')).toEqual([]);
  });
});

describe('the revision covers the schema too', () => {
  it('rebuilds when a connection switches schema under the same tables', () => {
    // Two schemas can hold the same table names. Keying only on those left the
    // cached tries answering for the schema the reader had left.
    const a = buildSchemaTries([source({ schema: 'demo_a' })]);
    const b = buildSchemaTries([source({ schema: 'demo_b' })]);
    expect(a.revision).not.toBe(b.revision);
  });

  it('stays stable when nothing changed', () => {
    expect(buildSchemaTries([source()]).revision).toBe(buildSchemaTries([source()]).revision);
  });
});
