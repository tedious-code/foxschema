/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dialect-specific syntax, as the SQL editor sees it.
 *
 * The editor splits before it does anything else — runs a statement, decides
 * whether it is a write, offers it to the caret. Every dialect brings its own
 * way of ending or nesting a statement, and a wrong split means running a
 * fragment of what the user typed.
 *
 * `splitSqlStatements` takes no dialect, so this also records where that costs
 * something. The two `it.fails` cases below are **known gaps, not
 * expectations** — they document exactly what breaks so the next person does
 * not have to rediscover it, and they will turn red the moment someone fixes
 * them, which is the signal to delete the `.fails`.
 */
import { describe, expect, it } from 'vitest';
import { isWriteStatement, splitSqlStatements } from './sql-splitter.js';

const parts = (sql: string) => splitSqlStatements(sql).filter((p) => p.text.trim());

describe('statement terminators per dialect', () => {
  it('keeps a MySQL DELIMITER block whole', () => {
    // Between DELIMITER $$ and DELIMITER ; the inner semicolons are body text.
    const sql = 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;';
    expect(parts(sql)).toHaveLength(1);
  });

  it('treats an Oracle slash as its own terminator', () => {
    const sql = 'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;\n/\nSELECT 1 FROM dual;';
    expect(parts(sql)).toHaveLength(2);
  });

  it('keeps a Postgres dollar-quoted body whole', () => {
    const sql =
      'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql;\nSELECT 1;';
    const out = parts(sql);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toContain('$$');
  });

  it('does not split inside quoted identifiers that contain a semicolon', () => {
    // A semicolon inside [brackets] or `backticks` is part of the name.
    expect(parts('SELECT * FROM [my;table];\nSELECT 2;')).toHaveLength(2);
    expect(parts('SELECT * FROM `a;b`;\nSELECT 2;')).toHaveLength(2);
  });

  it('does not split inside a string literal', () => {
    expect(parts("SELECT 'a;b' AS s;\nSELECT 2;")).toHaveLength(2);
  });
});

describe('known gaps — dialect syntax the splitter cannot see', () => {
  // Remove the `.fails` when these are fixed; a green run here means the gap
  // closed and the test should become an ordinary assertion.

  it.fails('T-SQL GO should end a batch', () => {
    // GO is a client-side batch separator, not SQL. The splitter does not know
    // it, so a whole GO script arrives as one statement and the server rejects
    // it ("Incorrect syntax near 'GO'"). Fixing it needs the dialect, which
    // splitSqlStatements does not currently take.
    expect(parts('SELECT 1\nGO\nSELECT 2\nGO')).toHaveLength(2);
  });

  it.fails('an anonymous BEGIN … END block should stay whole', () => {
    // PL/SQL and Db2 SQL PL both use bare `BEGIN … END;` blocks whose inner
    // semicolons are body text — the shape the Db2 tolerant-drop statements
    // use. The splitter chops `BEGIN NULL; END;` into two fragments, neither
    // of which runs. Migrations are unaffected (MigrationModule sends whole
    // statements), but pasting generated SQL into the editor breaks.
    //
    // The fix is not simply "treat BEGIN as an opener": in Postgres and MySQL
    // `BEGIN;` starts a transaction, so this needs the dialect or a heuristic
    // on what follows the keyword.
    expect(parts('BEGIN NULL; END;')).toHaveLength(1);
  });

  it('records what the GO gap does to write classification', () => {
    // Documented rather than asserted as correct: because the batch never
    // splits, a DELETE after GO sits inside a statement whose leading verb is
    // SELECT, and the whole thing reads as a non-write. It is not executable
    // either — the server rejects GO — so this misleads the confirmation
    // dialog without putting data at risk. Fixing the split fixes this too.
    const script = 'SELECT 1\nGO\nDELETE FROM accounts\nGO';
    expect(parts(script)).toHaveLength(1);
    expect(isWriteStatement(script)).toBe(false);
  });
});

describe('write detection across dialect-specific writes', () => {
  it.each([
    ['MySQL REPLACE', 'REPLACE INTO t (id) VALUES (1)'],
    ['Postgres COPY from', "COPY t FROM '/tmp/x.csv'"],
    ['MySQL LOAD DATA', "LOAD DATA INFILE '/tmp/x' INTO TABLE t"],
    ['SQL Server SELECT INTO', 'SELECT * INTO backup FROM t'],
    ['Oracle MERGE', 'MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.v = s.v'],
    ['TRUNCATE', 'TRUNCATE TABLE t'],
    ['Db2 anonymous block that writes', "BEGIN EXECUTE IMMEDIATE 'DROP TABLE t'; END"],
  ])('classifies %s as a write', (_label, sql) => {
    expect(isWriteStatement(sql)).toBe(true);
  });

  it.each([
    ['Oracle FROM DUAL', 'SELECT 1 FROM dual'],
    ['Db2 SYSDUMMY1', 'SELECT 1 FROM sysibm.sysdummy1'],
    ['SQL Server TOP', 'SELECT TOP 10 * FROM t'],
    ['Postgres LIMIT', 'SELECT * FROM t LIMIT 10'],
    ['SHOW', 'SHOW TABLES'],
  ])('classifies %s as a read', (_label, sql) => {
    expect(isWriteStatement(sql)).toBe(false);
  });
});
