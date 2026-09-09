/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orphan detection: child rows whose foreign key points at nothing.
 *
 * The assertions worth having here are the ones that decide whether the answer
 * is right rather than merely well-formed — NOT EXISTS over NOT IN, NULL keys
 * excluded, and a self-referencing table kept apart from itself.
 */
import { describe, expect, it } from 'vitest';
import { buildOrphanCount, buildOrphanPeek } from './tablePreview';
import type { ForeignKeyInfo } from './types';

const fk = (over: Partial<ForeignKeyInfo> = {}): ForeignKeyInfo => ({
  name: 'fk_orders_customer',
  columns: ['customer_id'],
  referencedTable: 'customers',
  referencedSchema: 'public',
  referencedColumns: ['id'],
  ...over,
});

describe('buildOrphanCount', () => {
  it('uses NOT EXISTS, because NOT IN gets this wrong when a parent key is NULL', () => {
    // A single NULL in the parent column makes `x NOT IN (SELECT …)` return no
    // rows at all, reporting a table full of orphans as clean. The two are not
    // interchangeable and only one of them answers the question.
    const q = buildOrphanCount('public.orders', fk(), 'postgres')!;
    expect(q.sql).toContain('NOT EXISTS');
    expect(q.sql).not.toContain('NOT IN');
  });

  it('does not count a NULL foreign key as an orphan', () => {
    // A NULL FK is an absent relationship, not a broken one. Counting it would
    // call every optional reference an orphan.
    const q = buildOrphanCount('public.orders', fk(), 'postgres')!;
    expect(q.sql).toContain('IS NOT NULL');
  });

  it('keeps both sides apart when a table references itself', () => {
    const q = buildOrphanCount(
      'public.employees',
      fk({ referencedTable: 'employees', columns: ['manager_id'], referencedColumns: ['id'] }),
      'postgres'
    )!;
    expect(q.sql).toContain('fox_c');
    expect(q.sql).toContain('fox_p');
  });

  it('pairs every column of a composite key, in order', () => {
    const q = buildOrphanCount(
      'public.order_items',
      fk({
        columns: ['order_region', 'order_id'],
        referencedTable: 'orders',
        referencedColumns: ['region', 'id'],
      }),
      'postgres'
    )!;
    expect(q.sql).toContain('"region" = fox_c."order_region"');
    expect(q.sql).toContain('"id" = fox_c."order_id"');
  });

  it('quotes for the dialect it is asked for', () => {
    expect(buildOrphanCount('app.orders', fk(), 'mysql')!.sql).toContain('`orders`');
    expect(buildOrphanCount('public.orders', fk(), 'postgres')!.sql).toContain('"orders"');
  });

  it('resolves the parent through its own schema, not the child\'s', () => {
    // A cross-schema FK that loses its schema resolves a bare name wherever the
    // connection happens to point — a different table with the same name.
    const q = buildOrphanCount(
      'sales.orders',
      fk({ referencedSchema: 'reference', referencedTable: 'customers' }),
      'postgres'
    )!;
    expect(q.sql).toContain('"reference"."customers"');
  });

  it('aliases tables without AS, which Oracle rejects', () => {
    // Verified against Oracle 23: `FROM demo_a.orders AS fox_c` is ORA-03048,
    // "SQL reserved word 'AS' is not syntactically valid". A bare correlation
    // name is accepted by every engine here, so there is no dialect branch.
    for (const dialect of ['oracle', 'postgres', 'mysql', 'sqlserver', 'db2']) {
      const q = buildOrphanCount('demo_a.orders', fk(), dialect)!;
      expect(q.sql, dialect).not.toMatch(/\bAS\s+fox_[cp]\b/);
      expect(q.sql, dialect).toMatch(/fox_c\b/);
    }
  });

  it('offers nothing when the catalog gave no usable column pair', () => {
    expect(buildOrphanCount('public.orders', fk({ columns: [] }), 'postgres')).toBeNull();
    expect(
      buildOrphanCount('public.orders', fk({ referencedColumns: ['a', 'b'] }), 'postgres')
    ).toBeNull();
    expect(buildOrphanCount('', fk(), 'postgres')).toBeNull();
  });
});

describe('buildOrphanPeek', () => {
  it('selects the offending rows rather than counting them', () => {
    const q = buildOrphanPeek('public.orders', fk(), 'postgres')!;
    expect(q.sql).toContain('fox_c.*');
    expect(q.sql).not.toContain('COUNT(*)');
  });

  it('asks the same question as the count, so the two cannot disagree', () => {
    const count = buildOrphanCount('public.orders', fk(), 'postgres')!;
    const peek = buildOrphanPeek('public.orders', fk(), 'postgres')!;
    const predicate = (s: string) => s.slice(s.indexOf(' WHERE '));
    expect(predicate(peek.sql)).toBe(predicate(count.sql));
  });
});
