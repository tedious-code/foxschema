/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reverse foreign keys: the rows that reference one parent row.
 *
 * The assertions that matter here are the ones that catch a query pointed at
 * the wrong side of the relation. A drill that selects the parent's columns
 * from the child's table still *looks* like a valid statement, so each test
 * pins the side it belongs to rather than only checking the SQL parses.
 */
import { describe, expect, it } from 'vitest';
import { inboundForeignKeysFor, buildInboundDrilldown } from './tablePreview';
import type { ForeignKeyInfo, TableSchema } from './types';

const fk = (over: Partial<ForeignKeyInfo> = {}): ForeignKeyInfo => ({
  name: 'fk_orders_customer',
  columns: ['customer_id'],
  referencedTable: 'customers',
  referencedSchema: 'public',
  referencedColumns: ['id'],
  ...over,
});

const table = (name: string, fks: ForeignKeyInfo[]): TableSchema =>
  ({ name, objectType: 'TABLE', columns: [], indices: [], foreignKeys: fks }) as unknown as TableSchema;

const catalog: TableSchema[] = [
  table('orders', [fk()]),
  table('invoices', [fk({ name: 'fk_inv_customer', columns: ['cust_id'] })]),
  table('products', [fk({ name: 'fk_prod_cat', referencedTable: 'categories' })]),
];

describe('inboundForeignKeysFor', () => {
  it('finds every child that points at the table, and nothing that does not', () => {
    const hits = inboundForeignKeysFor(catalog, 'customers');
    expect(hits.map((h) => h.table)).toEqual(['invoices', 'orders']);
    // `products` references `categories`; including it would offer the reader a
    // drill that returns rows unrelated to the row they clicked.
    expect(hits.some((h) => h.table === 'products')).toBe(false);
  });

  it('carries the child FK columns, not the parent ones', () => {
    // The whole point of this over findInboundForeignKeyTables: a name alone
    // cannot build a WHERE clause.
    const inv = inboundForeignKeysFor(catalog, 'customers').find((h) => h.table === 'invoices')!;
    expect(inv.fk.columns).toEqual(['cust_id']);
    expect(inv.fk.referencedColumns).toEqual(['id']);
  });

  it('matches a qualified parent name against a bare referencedTable', () => {
    // Catalogs disagree about qualifying `referencedTable`; a peek opened as
    // `public.customers` must still find `orders`.
    expect(inboundForeignKeysFor(catalog, 'public.customers').map((h) => h.table)).toEqual([
      'invoices',
      'orders',
    ]);
  });

  it('does not treat an explicitly different referenced schema as the target', () => {
    const crossSchema = [
      table('public.orders', [
        fk({
          name: 'fk_orders_inventory_product',
          referencedTable: 'products',
          referencedSchema: 'inventory',
          columns: ['product_id'],
          referencedColumns: ['id'],
        }),
      ]),
      table('public.products', []),
    ];

    const hits = inboundForeignKeysFor(crossSchema, 'public.products');
    const unsafeQuery = hits[0] ? buildInboundDrilldown(hits[0], [42], 'postgres') : undefined;
    expect({
      matches: hits.map((h) => h.table),
      sql: unsafeQuery?.sql,
    }).toEqual({
      matches: [],
      sql: undefined,
    });
    expect(inboundForeignKeysFor(crossSchema, 'products', 'public')).toEqual([]);
  });

  it('keeps a self-referencing key', () => {
    const emp = [table('employees', [fk({ name: 'fk_mgr', columns: ['manager_id'], referencedTable: 'employees' })])];
    // manager_id → employees.id is a real relation the reader can drill.
    expect(inboundForeignKeysFor(emp, 'employees').map((h) => h.fk.columns)).toEqual([['manager_id']]);
  });

  it('skips a key whose child columns the catalog omitted', () => {
    const broken = [table('orders', [fk({ columns: [] })])];
    // With no child column there is no WHERE to build, so offering the link
    // would produce a drill that selects the child table unfiltered.
    expect(inboundForeignKeysFor(broken, 'customers')).toEqual([]);
  });
});

describe('buildInboundDrilldown', () => {
  const child = { table: 'public.orders', fk: fk() };

  it('filters the child table on the child column, bound not pasted', () => {
    const q = buildInboundDrilldown(child, [42], 'postgres')!;
    // FROM the child, WHERE the child's own column — reversing either half
    // silently answers a different question.
    expect(q.sql).toMatch(/FROM\s+"public"\."orders"/i);
    expect(q.sql).toMatch(/WHERE\s+"customer_id"\s*=\s*\$1/i);
    expect(q.sql).not.toMatch(/"id"\s*=/i);
    expect(q.params).toEqual([42]);
  });

  it('ANDs every column of a composite key', () => {
    const composite = {
      table: 'order_lines',
      fk: fk({ columns: ['order_id', 'line_no'], referencedColumns: ['id', 'no'] }),
    };
    const q = buildInboundDrilldown(composite, [7, 2], 'postgres')!;
    expect(q.sql).toMatch(/"order_id"\s*=\s*\$1\s+AND\s+"line_no"\s*=\s*\$2/i);
    expect(q.params).toEqual([7, 2]);
  });

  it('refuses a NULL parent value instead of matching every NULL child', () => {
    // `col = NULL` is never true, so the drill would come back empty and read
    // as "nothing references this" — a wrong answer, not an empty one.
    expect(buildInboundDrilldown(child, [null], 'postgres')).toBeNull();
  });

  it('refuses when the parent and child sides disagree in length', () => {
    const lopsided = { table: 'order_lines', fk: fk({ columns: ['a', 'b'], referencedColumns: ['id'] }) };
    // Pairing values to columns by position is only meaningful when both sides
    // have the same shape.
    expect(buildInboundDrilldown(lopsided, [1, 2], 'postgres')).toBeNull();
  });

  it('refuses when the caller passes the wrong number of values', () => {
    expect(buildInboundDrilldown(child, [], 'postgres')).toBeNull();
    expect(buildInboundDrilldown(child, [1, 2], 'postgres')).toBeNull();
  });

  it('quotes per dialect', () => {
    const q = buildInboundDrilldown({ table: 'orders', fk: fk() }, [1], 'mysql')!;
    expect(q.sql).toMatch(/FROM\s+`orders`/);
  });
});
