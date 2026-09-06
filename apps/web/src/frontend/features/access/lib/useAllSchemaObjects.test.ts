/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which catalog objects become permission-grid rows, and under what name.
 *
 * The hook around this only sequences requests; the decisions worth pinning are
 * here. Two of them reach SQL directly: a row's name is an identifier, so
 * mangling its casing changes which object gets granted, and drawing a row for
 * an object that has no grantable privilege gives the reader a line of dead
 * checkboxes to wonder about.
 */
import { describe, expect, it } from 'vitest';
import { toSchemaObjects } from './useAllSchemaObjects';
import type { DbObjectType } from './access';

const obj = (name: string, objectType: DbObjectType) => ({ name, objectType });

describe('toSchemaObjects', () => {
  it('keeps the kinds a grid row can stand for', () => {
    const rows = toSchemaObjects('demo_a', [
      obj('customers', 'TABLE'),
      obj('v_orders', 'VIEW'),
      obj('sp_confirm', 'PROCEDURE'),
      obj('fn_total', 'FUNCTION'),
      obj('sales_rollup', 'MQT'),
    ]);
    expect(rows.map((r) => `${r.name}:${r.kind}`)).toEqual([
      'customers:table',
      'fn_total:function',
      'sales_rollup:table',
      'sp_confirm:procedure',
      'v_orders:view',
    ]);
  });

  it('drops the kinds that have no grantable privilege of their own', () => {
    // A trigger runs with its table's rights; sequences, types and roles are
    // scope-level rather than object-level. Each would draw a row whose every
    // cell is disabled, which reads as a bug in the grid.
    const rows = toSchemaObjects('demo_a', [
      obj('trg_audit', 'TRIGGER'),
      obj('order_seq', 'SEQUENCE'),
      obj('order_status', 'TYPE'),
      obj('admin', 'ROLE'),
      obj('customers', 'TABLE'),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['customers']);
  });

  it('strips a schema the provider baked into the name', () => {
    // Providers differ on whether `name` is qualified. The row carries its
    // schema in its own field, so a qualified name here would compile to
    // `demo_a.demo_a.customers`.
    const rows = toSchemaObjects('demo_a', [obj('demo_a.customers', 'TABLE')]);
    expect(rows).toEqual([{ schema: 'demo_a', name: 'customers', kind: 'table' }]);
  });

  it('leaves casing alone — the name is an identifier, not a match key', () => {
    // MySQL is case-sensitive on table names; lowercasing here would generate a
    // GRANT naming an object that does not exist.
    const rows = toSchemaObjects('DEMO_A', [obj('CustomerOrders', 'TABLE')]);
    expect(rows[0]!.name).toBe('CustomerOrders');
    expect(rows[0]!.schema).toBe('DEMO_A');
  });

  it('skips an object whose name is blank once trimmed', () => {
    const rows = toSchemaObjects('demo_a', [obj('   ', 'TABLE'), obj('customers', 'TABLE')]);
    expect(rows.map((r) => r.name)).toEqual(['customers']);
  });

  it('carries the schema it was asked for, including the empty one', () => {
    // MySQL/Oracle answer the schema list with nothing; the connection's own
    // database is still one group, and its rows fall back to the compile-time
    // schema rather than carrying a wrong one.
    const rows = toSchemaObjects('', [obj('customers', 'TABLE')]);
    expect(rows[0]!.schema).toBe('');
  });
});
