/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adversarial CTE and subquery syntax, aimed at the safety gates.
 *
 * Every guard in the SQL editor — the write-confirmation dialog, the RBAC
 * `editor.write` check, the "this UPDATE has no WHERE" warning — decides what a
 * statement *is* by scanning its text. A data-modifying CTE begins with the
 * word `WITH`, so a scanner that reads only the leading verb calls
 * `WITH x AS (DELETE FROM accounts) SELECT 1` a read and waves it straight past
 * the confirmation. These cases exist to keep that hole shut.
 *
 * The rule they encode: **a misread must fail closed.** Calling a read a write
 * costs one extra confirmation dialog; calling a write a read runs unreviewed
 * DDL against the user's database.
 */
import { describe, expect, it } from 'vitest';
import {
  isWriteStatement,
  requiresWritePermission,
  splitSqlStatements,
  dmlLacksWhere,
  referencedTableNames,
} from './sql-splitter.js';

describe('data-modifying CTEs are writes', () => {
  const WRITES = [
    // Postgres' data-modifying CTE: the DELETE runs, the SELECT reads what it
    // removed. Leading verb is WITH.
    'WITH gone AS (DELETE FROM accounts RETURNING *) SELECT * FROM gone',
    'WITH x AS (SELECT 1) INSERT INTO audit SELECT * FROM x',
    'WITH x AS (UPDATE t SET c = 1 RETURNING id) SELECT count(*) FROM x',
    // Nested one level down — the write is in a CTE of a CTE.
    'WITH a AS (WITH b AS (UPDATE t SET c = 1 RETURNING *) SELECT * FROM b) SELECT * FROM a',
    // Recursive CTE whose tail is the write.
    'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 5) DELETE FROM u WHERE id IN (SELECT n FROM t)',
    // Casing and whitespace are not a defence.
    'WiTh X aS (dElEtE fRoM t) sElEcT 1',
    '\n\n  with   x   as  (\n delete from t\n )\n select 1',
    // A comment before the statement must not hide the verb.
    '-- harmless looking\nWITH x AS (DELETE FROM t) SELECT 1',
    '/* block */ WITH x AS (TRUNCATE TABLE t) SELECT 1',
    // EXPLAIN ANALYZE executes its inner statement on Postgres.
    'EXPLAIN ANALYZE WITH x AS (DELETE FROM t) SELECT 1',
    // SELECT … INTO creates a table; wrapped in a CTE it still does.
    'WITH x AS (SELECT 1 AS n) SELECT * INTO backup FROM x',
  ];

  it.each(WRITES)('classifies as a write: %s', (sql) => {
    expect(isWriteStatement(sql), sql).toBe(true);
  });

  it.each(WRITES)('requires write permission: %s', (sql) => {
    expect(requiresWritePermission(sql), sql).toBe(true);
  });
});

describe('read-only CTEs and subqueries stay readable', () => {
  // The other half of the contract. If ordinary analytical SQL demanded a
  // confirmation every time, people would learn to click through the dialog —
  // which is how the dialog stops protecting anything.
  const READS = [
    'WITH recent AS (SELECT * FROM orders WHERE created_at > now() - interval \'7 days\') SELECT count(*) FROM recent',
    'WITH RECURSIVE tree(id, parent) AS (SELECT id, parent FROM nodes WHERE parent IS NULL UNION ALL SELECT n.id, n.parent FROM nodes n JOIN tree ON n.parent = tree.id) SELECT * FROM tree',
    'SELECT * FROM (SELECT id FROM t WHERE x = 1) AS sub',
    'SELECT (SELECT max(id) FROM orders) AS newest, (SELECT count(*) FROM users) AS people',
    'WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a CROSS JOIN b',
    // A write verb inside a string literal is data, not a statement.
    "SELECT 'DELETE FROM accounts' AS example",
    "WITH x AS (SELECT '; DROP TABLE t; --' AS s) SELECT * FROM x",
    // …and inside a comment.
    'SELECT 1 -- DELETE FROM accounts',
    'SELECT /* UPDATE t SET x=1 */ 1',
  ];

  it.each(READS)('classifies as a read: %s', (sql) => {
    expect(isWriteStatement(sql), sql).toBe(false);
  });
});

describe('splitting statements that contain CTEs and subqueries', () => {
  it('keeps a CTE and its tail together as one statement', () => {
    const sql = 'WITH x AS (SELECT 1) SELECT * FROM x';
    expect(splitSqlStatements(sql).filter((s) => s.text.trim())).toHaveLength(1);
  });

  it('does not split on a semicolon inside a CTE string literal', () => {
    // Splitting here would run `WITH x AS (SELECT '` as a statement of its own.
    const sql = "WITH x AS (SELECT 'a;b' AS s) SELECT * FROM x";
    const parts = splitSqlStatements(sql).filter((s) => s.text.trim());
    expect(parts).toHaveLength(1);
    expect(parts[0]!.text).toContain("'a;b'");
  });

  it('splits two CTE statements at the boundary between them', () => {
    const sql = 'WITH a AS (SELECT 1) SELECT * FROM a;\nWITH b AS (SELECT 2) SELECT * FROM b;';
    const parts = splitSqlStatements(sql).filter((s) => s.text.trim());
    expect(parts).toHaveLength(2);
    expect(parts[1]!.text).toContain('b');
  });

  it('treats a semicolon inside a dollar-quoted body as ordinary text', () => {
    const sql = 'CREATE FUNCTION f() RETURNS int AS $$ BEGIN DELETE FROM t; RETURN 1; END $$ LANGUAGE plpgsql';
    const parts = splitSqlStatements(sql).filter((s) => s.text.trim());
    expect(parts).toHaveLength(1);
  });

  it('classifies each statement of a mixed batch on its own merits', () => {
    const sql = 'SELECT 1;\nWITH x AS (DELETE FROM t) SELECT 1;';
    const parts = splitSqlStatements(sql).filter((s) => s.text.trim());
    expect(parts).toHaveLength(2);
    expect(isWriteStatement(parts[0]!.text)).toBe(false);
    expect(isWriteStatement(parts[1]!.text)).toBe(true);
  });
});

describe('missing-WHERE warning sees through a CTE', () => {
  it('flags a CTE-wrapped DELETE with no WHERE', () => {
    // The warning exists to stop `DELETE FROM accounts` emptying a table by
    // accident. Wrapping it in a CTE must not silence it.
    expect(dmlLacksWhere('WITH x AS (SELECT 1) DELETE FROM accounts')).toBe(true);
  });

  it('does not flag one that has a WHERE', () => {
    expect(dmlLacksWhere('WITH x AS (SELECT 1) DELETE FROM accounts WHERE id = 1')).toBe(false);
  });
});

describe('referenced tables in CTE queries', () => {
  it('names the real tables a CTE query reads', () => {
    const names = referencedTableNames(
      'WITH recent AS (SELECT * FROM orders) SELECT * FROM recent JOIN customers ON true'
    ).map((n) => n.toLowerCase());
    expect(names).toContain('orders');
    expect(names).toContain('customers');
  });

  it('recognises a CTE that declares a column list', () => {
    const names = referencedTableNames(
      'WITH t(a, b) AS (SELECT x, y FROM source) SELECT * FROM t'
    ).map((n) => n.toLowerCase());
    expect(names).toEqual(['source']);
  });

  it('recognises MATERIALIZED and NOT MATERIALIZED fences', () => {
    for (const fence of ['MATERIALIZED', 'NOT MATERIALIZED']) {
      const names = referencedTableNames(
        `WITH t AS ${fence} (SELECT * FROM source) SELECT * FROM t`
      ).map((n) => n.toLowerCase());
      expect(names, fence).toEqual(['source']);
    }
  });

  it('handles several CTEs, including one whose body holds a comma', () => {
    const names = referencedTableNames(
      'WITH a AS (SELECT x, y FROM one), b AS (SELECT z FROM two) SELECT * FROM a JOIN b ON true'
    ).map((n) => n.toLowerCase());
    expect(names.sort()).toEqual(['one', 'two']);
  });

  it('scans pathological input in linear time', () => {
    // The regex this replaced had adjacent optional whitespace groups, which
    // backtrack exponentially. Input like this is reachable from the editor, so
    // a slow scan is a denial of service, not a performance nit. Generous
    // bound: the point is "not exponential", not a benchmark.
    const evil = `WITH ${' '.repeat(50_000)}`;
    const started = Date.now();
    referencedTableNames(evil);
    referencedTableNames(`WITH a AS ${'('.repeat(2_000)}`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('does not report a CTE alias as a table', () => {
    // `recent` is a name that exists only inside the query. Reporting it as a
    // table makes the multi-table write warning count phantom tables, and any
    // dependency scan built on this would chase an object that never existed.
    const names = referencedTableNames(
      'WITH recent AS (SELECT * FROM orders) SELECT * FROM recent'
    ).map((n) => n.toLowerCase());
    expect(names).not.toContain('recent');
  });
});
