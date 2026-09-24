/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The one rule for "same definition", shared by Compare and Lokee's hash.
 */
import { describe, expect, it } from 'vitest';
import { normalizeDefinitionText } from './definition-text.js';

const same = (a: string, b: string, schemas: string[] = []) =>
  expect(normalizeDefinitionText(a, schemas)).toBe(normalizeDefinitionText(b, schemas));
const differ = (a: string, b: string, schemas: string[] = []) =>
  expect(normalizeDefinitionText(a, schemas)).not.toBe(normalizeDefinitionText(b, schemas));

describe('normalizeDefinitionText', () => {
  it('treats upper- and lower-case keywords and identifiers as the same', () => {
    same('CREATE VIEW V_ORDERS AS SELECT ID, TOTAL FROM ORDERS', 'create view v_orders as select id, total from orders');
  });

  it('treats schema-qualified and unqualified references as the same', () => {
    same(
      'CREATE VIEW app.v AS SELECT o.id FROM app.orders o JOIN app.items i ON i.oid = o.id WHERE app.fn(o.id) > 0',
      'CREATE VIEW v AS SELECT o.id FROM orders o JOIN items i ON i.oid = o.id WHERE fn(o.id) > 0',
      ['app']
    );
    // Quoted, bracketed and position-independent qualifiers for the named schema.
    same('SELECT NEXT VALUE FOR [app].[seq]', 'SELECT NEXT VALUE FOR [seq]', ['app']);
    same('CREATE TRIGGER t AFTER INSERT ON "app".customers', 'CREATE TRIGGER t AFTER INSERT ON customers', ['app']);
  });

  it('treats whitespace and a trailing terminator as formatting', () => {
    same('SELECT id\n    FROM orders;', 'select id from orders');
  });

  it('tells genuinely different definitions apart', () => {
    differ('SELECT id FROM orders', 'SELECT id, total FROM orders');
    differ('SELECT id FROM orders', 'SELECT id FROM order_archive');
  });

  it("keeps a string literal's case: 'Active' and 'active' select different rows", () => {
    differ("SELECT * FROM t WHERE status = 'Active'", "SELECT * FROM t WHERE status = 'active'");
    // ...while the code around the literal still folds.
    same("SELECT * FROM T WHERE STATUS = 'Active'", "select * from t where status = 'Active'");
  });

  it("keeps a literal open across an escaped '' quote", () => {
    differ("SELECT 'It''s ON'", "SELECT 'It''s on'");
    same("SELECT 'It''s ON' FROM T", "select 'It''s ON' from t");
  });

  it('does not let an apostrophe in a comment start a literal', () => {
    same("-- don't\nSELECT ID FROM T", "-- DON'T\nselect id from t");
    same("/* it's */ SELECT ID FROM T", "/* IT'S */ select id from t");
  });

  it('is empty for no definition', () => {
    expect(normalizeDefinitionText(null)).toBe('');
    expect(normalizeDefinitionText(undefined)).toBe('');
    expect(normalizeDefinitionText('')).toBe('');
  });
});
