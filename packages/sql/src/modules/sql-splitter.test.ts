import { describe, it, expect } from 'vitest';
import {
  splitSqlStatements,
  checkStatement,
  isWriteStatement,
  requiresWritePermission,
  sqlStatementCategory,
  sqlStatementCategories,
  statementVerb,
  firstKeyword,
  extractTableAliases,
  countReferencedTables,
  referencedTableNames,
  isMutatingDmlStatement,
  dmlLacksWhere,
  parseCodeCell,
  stripFullLineSqlComments,
  codeCellHasReturn,
} from './sql-splitter.js';

describe('splitSqlStatements', () => {
  it('splits simple semicolon-terminated statements with line numbers', () => {
    const sql = 'SELECT 1;\nSELECT 2;\n';
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toMatchObject({ text: 'SELECT 1;', startLine: 1, endLine: 1, terminated: true });
    expect(stmts[1]).toMatchObject({ text: 'SELECT 2;', startLine: 2, endLine: 2, terminated: true });
  });

  it('marks an unterminated final statement', () => {
    const stmts = splitSqlStatements('SELECT 1;\nSELECT 2');
    expect(stmts).toHaveLength(2);
    expect(stmts[1]).toMatchObject({ text: 'SELECT 2', terminated: false });
  });

  it('ignores semicolons inside single quotes (with doubling) and double quotes', () => {
    const stmts = splitSqlStatements(`SELECT 'a;b', 'it''s;fine', ";x" FROM t;SELECT 2;`);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].text).toContain(`'a;b'`);
  });

  it('ignores semicolons inside backticks, brackets, and dollar quotes', () => {
    const stmts = splitSqlStatements('SELECT `a;b`, [c;d] FROM t;\nSELECT $tag$ x; y $tag$;');
    expect(stmts).toHaveLength(2);
    expect(stmts[1].text).toContain('$tag$ x; y $tag$');
  });

  it('ignores semicolons in line and block comments, and drops comment-only segments', () => {
    const sql = '-- lead;ing\nSELECT 1; /* mid;dle */\n-- trailing only\n';
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].text).toBe('SELECT 1;');
  });

  it('puts startLine on the first code line, not a leading comment', () => {
    const stmts = splitSqlStatements('-- comment\n\nSELECT 1;');
    expect(stmts).toHaveLength(1);
    expect(stmts[0].startLine).toBe(3);
  });

  it('handles multi-line statements and CRLF input', () => {
    const stmts = splitSqlStatements('SELECT a\r\nFROM t\r\nWHERE x = 1;\r\nSELECT 2;');
    expect(stmts).toHaveLength(2);
    expect(stmts[0].startLine).toBe(1);
    expect(stmts[0].endLine).toBe(3);
    expect(stmts[1].startLine).toBe(4);
  });

  it('returns [] for empty and whitespace/comment-only input', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('  \n\t')).toEqual([]);
    expect(splitSqlStatements('-- nothing\n/* here */')).toEqual([]);
  });

  it('handles MySQL # comments and backslash escapes in strings', () => {
    const stmts = splitSqlStatements("# note;\nSELECT 'a\\';b' FROM t;");
    expect(stmts).toHaveLength(1);
    expect(stmts[0].text).toBe("SELECT 'a\\';b' FROM t;");
  });

  it('keeps JS/TS fences as one statement (inner semicolons ok)', () => {
    const sql = `SELECT 1 AS id;
-- @js
const x = 1; const y = 2;
return { columns: ['n'], rows: [[x + y]] };
-- @end
SELECT 2;`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toMatchObject({ kind: 'sql', text: 'SELECT 1 AS id;' });
    expect(stmts[1]?.kind).toBe('js');
    expect(stmts[1]?.terminated).toBe(true);
    expect(stmts[1]?.text).toContain('const x = 1;');
    expect(stmts[1]?.text).toContain('-- @end');
    expect(stmts[2]).toMatchObject({ kind: 'sql', text: 'SELECT 2;' });
  });

  it('supports -- @ts / -- @typescript fences', () => {
    const stmts = splitSqlStatements(`-- @ts
const n: number = 1;
return { columns: ['n'], rows: [[n]] };
-- @end`);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]?.kind).toBe('ts');

    const long = splitSqlStatements(`-- @typescript
return [];
-- @end`);
    expect(long[0]?.kind).toBe('ts');

    const jsLong = splitSqlStatements(`-- @javascript
return [];
-- @end`);
    expect(jsLong[0]?.kind).toBe('js');
  });

  it('supports -- @node / -- @nodets fences', () => {
    const node = splitSqlStatements(`-- @node
return [{ ok: true }];
-- @end`);
    expect(node[0]?.kind).toBe('node');
    expect(node[0]?.terminated).toBe(true);

    const nodets = splitSqlStatements(`-- @nodets
const n: number = 1;
return [{ n }];
-- @end`);
    expect(nodets[0]?.kind).toBe('nodets');

    const alias = splitSqlStatements(`-- @node-typescript
return [];
-- @end`);
    expect(alias[0]?.kind).toBe('nodets');
  });

  it('treats code cells as non-writes and reports js/ts/node verb', () => {
    const js = splitSqlStatements(`-- @js\nreturn [];\n-- @end`)[0]!;
    expect(isWriteStatement(js.text)).toBe(false);
    expect(statementVerb(js.text)).toBe('js');

    const ts = splitSqlStatements(`-- @ts\nreturn [];\n-- @end`)[0]!;
    expect(isWriteStatement(ts.text)).toBe(false);
    expect(statementVerb(ts.text)).toBe('ts');

    const node = splitSqlStatements(`-- @node\nreturn [];\n-- @end`)[0]!;
    expect(isWriteStatement(node.text)).toBe(false);
    expect(statementVerb(node.text)).toBe('node');
  });

  it('does not treat return inside comments as a real return', () => {
    const stmts = splitSqlStatements(`-- @js
// return nowhere
const x = 1;
-- @end`);
    expect(checkStatement(stmts[0]!).reasons.join()).toMatch(/return/i);
  });

  it('warns when -- @end is missing', () => {
    const stmts = splitSqlStatements(`-- @js
return last;`);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]?.terminated).toBe(false);
    expect(checkStatement(stmts[0]!).level).toBe('warn');
    expect(checkStatement(stmts[0]!).reasons.join()).toMatch(/@end/);
  });

  it('warns when a closed code cell has no return', () => {
    const stmts = splitSqlStatements(`-- @js
const x = 1;
-- @end`);
    expect(checkStatement(stmts[0]!).level).toBe('warn');
    expect(checkStatement(stmts[0]!).reasons.join()).toMatch(/return/i);
  });

  it('ok for a closed code cell with return + locals/loop', () => {
    const stmts = splitSqlStatements(`-- @js
const out = [];
for (const r of last.rows) out.push(r);
return out;
-- @end`);
    expect(checkStatement(stmts[0]!)).toEqual({ level: 'ok', reasons: [] });
  });

  it('strips -- @end even when a trailing blank line follows', () => {
    const parsed = parseCodeCell(`-- @js
return [];
-- @end
`);
    expect(parsed).toMatchObject({ kind: 'js', closed: true, body: 'return [];' });
  });

  it('stripFullLineSqlComments drops SQL -- lines that would break JS', () => {
    expect(
      stripFullLineSqlComments(`-- use last from prior cell
return last;
const n = a - b;
`)
    ).toBe(`return last;\nconst n = a - b;\n`);
  });

  it('preserves @set comments before a code fence via offsets', () => {
    const sql = `SELECT 1;
-- @set src = table
-- @js
return last;
-- @end`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[1]?.kind).toBe('js');
    // Gap comments live before the fence start; reattachSetComments restores them.
    expect(sql.slice(stmts[0]!.end, stmts[1]!.start)).toContain('-- @set src = table');
  });
});

describe('checkStatement', () => {
  const stmt = (text: string, terminated = text.trimEnd().endsWith(';')) => ({ text, terminated });

  it('ok for a complete terminated statement', () => {
    expect(checkStatement(stmt('SELECT * FROM users WHERE id = 1;'))).toEqual({ level: 'ok', reasons: [] });
  });

  it('warns on a missing final semicolon', () => {
    const s = checkStatement(stmt('SELECT 1', false));
    expect(s.level).toBe('warn');
    expect(s.reasons).toContain('Missing terminating semicolon');
  });

  it('warns on unclosed quote and unbalanced parentheses', () => {
    expect(checkStatement(stmt("SELECT 'oops;")).reasons).toContain('Unclosed quote');
    expect(checkStatement(stmt('SELECT (1 + (2;')).reasons).toContain('Unbalanced parentheses');
  });

  it('warns on an unknown leading keyword but accepts common ones', () => {
    expect(checkStatement(stmt('FROBNICATE x;')).reasons.join()).toMatch(/FROBNICATE/);
    for (const good of ['WITH x AS (SELECT 1) SELECT * FROM x;', 'EXPLAIN SELECT 1;', 'pragma table_info(t);']) {
      expect(checkStatement(stmt(good)).level).toBe('ok');
    }
  });

  it('skips leading comments when finding the keyword', () => {
    expect(checkStatement(stmt('/* hint */ SELECT 1;')).level).toBe('ok');
  });
});

describe('isWriteStatement / firstKeyword', () => {
  it('classifies writes', () => {
    for (const w of ['INSERT INTO t VALUES (1);', 'update t set x=1;', 'DROP TABLE t;', 'Alter Table t ADD c int;', 'TRUNCATE t;']) {
      expect(isWriteStatement(w)).toBe(true);
    }
  });
  it('classifies CTE-leading writes as writes', () => {
    for (const w of [
      'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x;',
      'WITH a AS (SELECT 1), b AS (SELECT 2) UPDATE t SET n = 1;',
      'with recursive cte as (select 1 as n union all select n+1 from cte where n < 3) DELETE FROM t WHERE id IN (SELECT n FROM cte);',
    ]) {
      expect(isWriteStatement(w)).toBe(true);
    }
  });
  it('classifies data-modifying CTEs that return via SELECT as writes', () => {
    for (const w of [
      'WITH wiped AS (DELETE FROM orders RETURNING id) SELECT * FROM wiped;',
      'WITH u AS (UPDATE t SET n = 1 RETURNING *) SELECT * FROM u;',
      'WITH i AS (INSERT INTO t VALUES (1) RETURNING id) SELECT * FROM i;',
      // Nested WITH whose inner CTE mutates.
      'WITH outer AS (WITH inner AS (DELETE FROM t RETURNING id) SELECT * FROM inner) SELECT * FROM outer;',
    ]) {
      expect(isWriteStatement(w)).toBe(true);
    }
  });
  it('classifies reads and no-keyword text as non-writes', () => {
    for (const r of ['SELECT 1;', 'WITH x AS (SELECT 1) SELECT * FROM x;', 'EXPLAIN DELETE FROM t;', '???']) {
      expect(isWriteStatement(r)).toBe(false);
    }
  });
  it('classifies EXPLAIN ANALYZE of a write as a write (plan is executed)', () => {
    for (const w of [
      'EXPLAIN ANALYZE DELETE FROM t;',
      'explain analyze update t set x = 1;',
      'EXPLAIN (ANALYZE) DELETE FROM t;',
      'EXPLAIN (ANALYZE, BUFFERS) UPDATE t SET x = 1;',
      'EXPLAIN ANALYZE WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x;',
      // Legacy Postgres VERBOSE / MySQL FORMAT= sit between ANALYZE and the stmt.
      'EXPLAIN ANALYZE VERBOSE DELETE FROM t;',
      'EXPLAIN (ANALYZE) VERBOSE DELETE FROM t;',
      'EXPLAIN ANALYZE FORMAT=TREE DELETE FROM t;',
      'EXPLAIN ANALYZE FORMAT = JSON UPDATE t SET x = 1;',
    ]) {
      expect(isWriteStatement(w)).toBe(true);
    }
    // ANALYZE of a read stays a read; plain EXPLAIN of a write stays non-write.
    expect(isWriteStatement('EXPLAIN ANALYZE SELECT 1;')).toBe(false);
    expect(isWriteStatement('EXPLAIN ANALYZE VERBOSE SELECT 1;')).toBe(false);
    expect(isWriteStatement('EXPLAIN (BUFFERS) DELETE FROM t;')).toBe(false);
  });
  it('classifies CALL/EXEC/DO/COPY/REFRESH as writes (RBAC fail-closed)', () => {
    for (const w of [
      'CALL mutate_proc();',
      'EXEC sp_mutate;',
      'EXECUTE sp_mutate;',
      'DO $$ BEGIN DELETE FROM t; END $$;',
      'COPY t FROM STDIN;',
      'REFRESH MATERIALIZED VIEW mv;',
    ]) {
      expect(isWriteStatement(w)).toBe(true);
    }
  });
  it('firstKeyword skips comments and parens', () => {
    expect(firstKeyword('-- c\n(SELECT 1) UNION SELECT 2;')).toBe('select');
    expect(firstKeyword('/* x */ INSERT INTO t;')).toBe('insert');
    expect(firstKeyword('123')).toBe(null);
  });
});

describe('isMutatingDmlStatement / dmlLacksWhere', () => {
  it('flags UPDATE DELETE MERGE including CTE wrappers', () => {
    expect(isMutatingDmlStatement('UPDATE t SET x = 1 WHERE id = 1;')).toBe(true);
    expect(isMutatingDmlStatement('DELETE FROM t WHERE id = 1;')).toBe(true);
    expect(
      isMutatingDmlStatement(
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1;'
      )
    ).toBe(true);
    expect(isMutatingDmlStatement('WITH x AS (SELECT 1) DELETE FROM t;')).toBe(true);
    expect(
      isMutatingDmlStatement('WITH wiped AS (DELETE FROM orders RETURNING id) SELECT * FROM wiped;')
    ).toBe(true);
    expect(isMutatingDmlStatement('INSERT INTO t VALUES (1);')).toBe(false);
    expect(isMutatingDmlStatement('SELECT 1;')).toBe(false);
    // Plain EXPLAIN is planning-only; EXPLAIN ANALYZE executes the DML.
    expect(isMutatingDmlStatement('EXPLAIN DELETE FROM t;')).toBe(false);
    expect(isMutatingDmlStatement('EXPLAIN ANALYZE DELETE FROM t;')).toBe(true);
    expect(isMutatingDmlStatement('EXPLAIN ANALYZE VERBOSE DELETE FROM t;')).toBe(true);
    expect(isMutatingDmlStatement('EXPLAIN (ANALYZE, BUFFERS) UPDATE t SET x = 1;')).toBe(true);
  });
  it('detects missing WHERE on UPDATE/DELETE', () => {
    expect(dmlLacksWhere('UPDATE t SET x = 1;')).toBe(true);
    expect(dmlLacksWhere('DELETE FROM t;')).toBe(true);
    expect(dmlLacksWhere('UPDATE t SET x = 1 WHERE id = 1;')).toBe(false);
    expect(dmlLacksWhere('DELETE FROM t WHERE id = 1;')).toBe(false);
    expect(dmlLacksWhere('MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE;')).toBe(false);
    expect(dmlLacksWhere('EXPLAIN ANALYZE DELETE FROM t;')).toBe(true);
  });
});

describe('extractTableAliases', () => {
  it('maps FROM/JOIN aliases and bare table names', () => {
    const map = extractTableAliases('SELECT u.id FROM users u JOIN orders o ON o.uid = u.id');
    expect(map.u).toBe('users');
    expect(map.o).toBe('orders');
    expect(map.users).toBe('users');
    expect(map.orders).toBe('orders');
  });

  it('accepts optional AS and UPDATE/INTO forms', () => {
    expect(extractTableAliases('SELECT * FROM users AS u').u).toBe('users');
    expect(extractTableAliases('UPDATE users SET x = 1').users).toBe('users');
    expect(extractTableAliases('INSERT INTO t (a) VALUES (1)').t).toBe('t');
  });

  it('ignores keyword blacklist aliases (FROM t WHERE …)', () => {
    const map = extractTableAliases('SELECT * FROM t WHERE x = 1');
    expect(map.t).toBe('t');
    expect(map.where).toBeUndefined();
  });

  it('handles schema-qualified and quoted identifiers', () => {
    const map = extractTableAliases('SELECT * FROM public.users u JOIN "Odd Name" AS n ON true');
    expect(map.u).toBe('public.users');
    expect(map.users).toBe('public.users');
    expect(map.n).toBe('Odd Name');
  });

  it('picks up comma-separated FROM aliases', () => {
    const map = extractTableAliases('SELECT * FROM users u, orders o WHERE u.id = o.uid');
    expect(map.u).toBe('users');
    expect(map.o).toBe('orders');
  });

  it('allows keyword table names with a short alias (FROM ORDER u)', () => {
    const map = extractTableAliases('SELECT u.id FROM ORDER u');
    expect(map.u).toBe('ORDER');
    expect(map.order).toBe('ORDER');
    const quoted = extractTableAliases('SELECT u.x FROM "ORDER" AS u');
    expect(quoted.u).toBe('ORDER');
  });

  it('does not treat SELECT-list , table.col FROM as a FROM item', () => {
    const map = extractTableAliases(
      'SELECT orders.created_at, orders.customer_id from orders'
    );
    expect(map.orders).toBe('orders');
    expect(map['orders.customer_id']).toBeUndefined();
    expect(map.customer_id).toBeUndefined();
  });
});

describe('countReferencedTables / referencedTableNames', () => {
  it('counts distinct tables across joins (aliases collapse)', () => {
    expect(
      countReferencedTables('SELECT * FROM users u JOIN orders o ON o.uid = u.id JOIN users u2 ON 1=1')
    ).toBe(2);
    expect(referencedTableNames('UPDATE users SET x = 1')).toEqual(['users']);
  });

  it('returns 0 for statements without FROM/JOIN/UPDATE/INTO tables', () => {
    expect(countReferencedTables('SELECT 1')).toBe(0);
    expect(countReferencedTables('-- comment only')).toBe(0);
  });
});

describe('codeCellHasReturn with regex literals', () => {
  it('sees a return after a regex that ends in an escaped slash', () => {
    // `/\//` used to read as a `//` line comment, swallowing the return.
    expect(codeCellHasReturn(String.raw`const p = String(x).split(/\//); return [{ p }];`)).toBe(
      true
    );
    expect(codeCellHasReturn(String.raw`const re = /^https:\/\//; return [{ ok: re.test(x) }];`)).toBe(
      true
    );
  });

  it('still ignores return inside comments and strings', () => {
    expect(codeCellHasReturn('// return []\nconst x = 1;')).toBe(false);
    expect(codeCellHasReturn('/* return */ const x = 1;')).toBe(false);
    expect(codeCellHasReturn(`const s = 'return'; const t = "return";`)).toBe(false);
    expect(codeCellHasReturn('const t = `no return here`;')).toBe(false);
  });

  it('does not mistake division for a regex', () => {
    expect(codeCellHasReturn('const n = a / b / c; return [{ n }];')).toBe(true);
    expect(codeCellHasReturn('const n = a / b / c;')).toBe(false);
  });
});

describe('requiresWritePermission (fail-closed RBAC gate)', () => {
  const needsWrite = (sql: string) => requiresWritePermission(sql);

  it('allows plain reads', () => {
    for (const sql of [
      'SELECT 1',
      'SELECT * FROM users WHERE id = 1',
      'SHOW TABLES',
      'DESCRIBE users',
      'VALUES (1), (2)',
      'EXPLAIN SELECT * FROM users',
      'WITH t AS (SELECT 1) SELECT * FROM t',
      'PRAGMA table_info(users)',
      '-- just a comment',
    ]) {
      expect(needsWrite(sql), sql).toBe(false);
    }
  });

  it('catches the writes a leading-keyword denylist missed', () => {
    for (const sql of [
      'SELECT * INTO evil FROM users', // sqlserver / postgres: creates a table
      "SELECT * FROM users INTO OUTFILE '/tmp/x'", // mysql: writes a file
      "LOAD DATA INFILE '/tmp/x' INTO TABLE users", // mysql: bulk insert
      "UNLOAD ('select 1') TO 's3://b/k'", // redshift: exfiltrates
      'PRAGMA journal_mode = WAL', // sqlite: mutates config
      'SET GLOBAL max_connections = 1',
      'VACUUM',
      'ANALYZE users',
    ]) {
      expect(needsWrite(sql), sql).toBe(true);
    }
  });

  it('still catches everything the denylist already caught', () => {
    for (const sql of [
      'DELETE FROM users',
      'UPDATE users SET a = 1',
      'DROP TABLE users',
      'CALL do_thing()',
      'EXPLAIN ANALYZE DELETE FROM users',
      'EXPLAIN ANALYZE VERBOSE DELETE FROM users',
      'EXPLAIN (ANALYZE, VERBOSE) DELETE FROM users',
      'WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d',
    ]) {
      expect(needsWrite(sql), sql).toBe(true);
    }
  });

  it('denies an unknown verb rather than permitting it', () => {
    // The whole point of the inversion: a verb nobody enumerated fails closed.
    for (const sql of ['FLASHBACK TABLE t TO BEFORE DROP', 'BULK INSERT t FROM \'f\'', 'LOCK TABLES t WRITE']) {
      expect(needsWrite(sql), sql).toBe(true);
    }
  });

  it('is not fooled by INTO inside a string or comment', () => {
    expect(needsWrite("SELECT 'into outfile' AS note")).toBe(false);
    expect(needsWrite('SELECT 1 -- INTO evil')).toBe(false);
    expect(needsWrite('SELECT 1 /* INTO evil */')).toBe(false);
  });

  it('leaves code cells to the bridge', () => {
    expect(needsWrite('-- @node\nreturn [];\n-- @end')).toBe(false);
  });
});

describe('isWriteStatement — Safe Mode catches bulk/INTO writes too', () => {
  it('warns on SELECT … INTO and bulk load verbs', () => {
    expect(isWriteStatement('SELECT * INTO evil FROM users')).toBe(true);
    expect(isWriteStatement("SELECT * FROM users INTO OUTFILE '/tmp/x'")).toBe(true);
    expect(isWriteStatement("LOAD DATA INFILE '/tmp/x' INTO TABLE users")).toBe(true);
    expect(isWriteStatement("UNLOAD ('select 1') TO 's3://b/k'")).toBe(true);
  });

  it('still treats a plain SELECT as a read', () => {
    expect(isWriteStatement('SELECT * FROM users')).toBe(false);
    expect(isWriteStatement("SELECT 'into outfile' AS note")).toBe(false);
  });
});

describe('WITH tail is classified, not just its leading verb', () => {
  // Reported by Cursor Bugbot on #153: the tail passed on keyword membership
  // alone, so anything needing deeper analysis slipped through.
  it('gates a WITH tail that only looks like a read', () => {
    for (const sql of [
      'WITH t AS (SELECT 1) EXPLAIN ANALYZE DELETE FROM users',
      'WITH t AS (SELECT 1) PRAGMA journal_mode = WAL',
      'WITH t AS (SELECT 1) SELECT * INTO evil FROM t',
      'WITH a AS (SELECT 1) WITH b AS (DELETE FROM t RETURNING *) SELECT * FROM b',
    ]) {
      expect(requiresWritePermission(sql), sql).toBe(true);
    }
  });

  it('keeps genuinely read-only WITH statements readable', () => {
    for (const sql of [
      'WITH t AS (SELECT 1) SELECT * FROM t',
      'WITH RECURSIVE t AS (SELECT 1) SELECT * FROM t',
      'WITH a AS (SELECT 1) WITH b AS (SELECT 2) SELECT * FROM b',
      'WITH t AS (SELECT 1) TABLE t',
    ]) {
      expect(requiresWritePermission(sql), sql).toBe(false);
    }
  });

  it('Safe Mode warns on the same tails', () => {
    expect(isWriteStatement('WITH t AS (SELECT 1) SELECT * INTO evil FROM t')).toBe(true);
    expect(isWriteStatement('WITH t AS (SELECT 1) EXPLAIN ANALYZE DELETE FROM users')).toBe(true);
    expect(isWriteStatement('WITH t AS (SELECT 1) SELECT * FROM t')).toBe(false);
  });

  it('still flags mutating DML through a WITH tail', () => {
    expect(isMutatingDmlStatement('WITH t AS (SELECT 1) UPDATE users SET a = 1')).toBe(true);
    expect(isMutatingDmlStatement('WITH t AS (SELECT 1) SELECT * FROM t')).toBe(false);
  });
});

describe('sqlStatementCategory (RBAC buckets)', () => {
  const cat = (s: string) => sqlStatementCategory(s);

  it('reads stay reads', () => {
    for (const s of ['SELECT 1', 'SHOW TABLES', 'EXPLAIN SELECT 1', 'PRAGMA table_info(t)',
                     'WITH t AS (SELECT 1) SELECT * FROM t']) {
      expect(cat(s), s).toBe('read');
    }
  });

  it('row changes are dml', () => {
    for (const s of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t',
                     'MERGE INTO t USING s ON (1=1)', "LOAD DATA INFILE '/x' INTO TABLE t"]) {
      expect(cat(s), s).toBe('dml');
    }
  });

  it('schema changes are ddl', () => {
    for (const s of ['CREATE TABLE t (a int)', 'ALTER TABLE t ADD b int', 'DROP VIEW v',
                     'TRUNCATE TABLE t', 'CREATE INDEX i ON t(a)', 'CREATE PROCEDURE p() BEGIN END',
                     'SELECT * INTO copy FROM t', 'PRAGMA journal_mode = WAL', 'CALL p()']) {
      expect(cat(s), s).toBe('ddl');
    }
  });

  it('privilege changes get their own bucket', () => {
    for (const s of ['GRANT SELECT ON t TO bob', 'REVOKE ALL ON t FROM bob']) {
      expect(cat(s), s).toBe('grant');
    }
  });

  it('an unknown verb falls into ddl rather than read', () => {
    expect(cat('FLASHBACK TABLE t TO BEFORE DROP')).toBe('ddl');
  });

  it('a WITH takes the broadest category found anywhere in it', () => {
    expect(cat('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d')).toBe('dml');
    expect(cat('WITH t AS (SELECT 1) SELECT * INTO copy FROM t')).toBe('ddl');
  });

  it('EXPLAIN ANALYZE inherits the inner statement', () => {
    expect(cat('EXPLAIN ANALYZE DELETE FROM t')).toBe('dml');
    expect(cat('EXPLAIN ANALYZE SELECT 1')).toBe('read');
  });
});

describe('RBAC classifier — leading punctuation / batches / parenthesized PRAGMA', () => {
  // Verified against better-sqlite3: `PRAGMA user_version(123)` mutates, and
  // `; DELETE FROM t` prepares and runs. The pre-fix classifier treated both
  // as reads, so a viewer could write through /sql/execute and the code-cell bridge.

  it('does not treat a leading semicolon as a read', () => {
    expect(firstKeyword('; DELETE FROM users')).toBe('delete');
    expect(sqlStatementCategory('; DELETE FROM users')).toBe('dml');
    expect(sqlStatementCategory(';DELETE FROM users')).toBe('dml');
    expect(requiresWritePermission('; DELETE FROM users')).toBe(true);
    expect(isWriteStatement('; DELETE FROM users')).toBe(true);
  });

  it('fails closed when the text starts with non-keyword punctuation', () => {
    expect(sqlStatementCategory('!!! DELETE FROM users')).toBe('ddl');
    expect(requiresWritePermission('!!! DELETE FROM users')).toBe(true);
    expect(sqlStatementCategory('-- just a comment')).toBe('read');
    expect(requiresWritePermission('-- just a comment')).toBe(false);
  });

  it('classifies every statement in a batch, not only the leading verb', () => {
    expect(sqlStatementCategory('SELECT 1; DELETE FROM users')).toBe('dml');
    expect(sqlStatementCategory('EXPLAIN SELECT 1; DROP TABLE users')).toBe('ddl');
    expect(sqlStatementCategory('SELECT 1; GRANT SELECT ON t TO bob')).toBe('grant');
    expect(requiresWritePermission('SELECT 1; DELETE FROM users')).toBe(true);
    expect(isWriteStatement('SELECT 1; DELETE FROM users')).toBe(true);
  });

  it('demands every permission present in a mixed batch', () => {
    expect(sqlStatementCategories('CREATE TABLE t (a int); GRANT SELECT ON t TO bob').sort()).toEqual(
      ['ddl', 'grant']
    );
    expect(sqlStatementCategories('DELETE FROM t; CREATE TABLE u (a int)').sort()).toEqual(
      ['ddl', 'dml']
    );
  });

  it('treats parenthesized PRAGMA assignment as ddl, keeps table_info as read', () => {
    expect(sqlStatementCategory('PRAGMA user_version(123)')).toBe('ddl');
    expect(sqlStatementCategory('PRAGMA journal_mode(WAL)')).toBe('ddl');
    expect(sqlStatementCategory('PRAGMA table_info(users)')).toBe('read');
    expect(sqlStatementCategory('PRAGMA main.table_info(users)')).toBe('read');
    expect(requiresWritePermission('PRAGMA user_version(123)')).toBe(true);
    expect(isWriteStatement('PRAGMA user_version(123)')).toBe(true);
    expect(requiresWritePermission('PRAGMA table_info(users)')).toBe(false);
  });

  it('does not treat a code-fence prefix as a free pass for trailing SQL', () => {
    // `-- @node` / `-- @end` are ordinary SQL `--` comments to the database.
    // A viewer posting these through /sql/execute (or a cell emitting them on
    // the bridge) must still need editor.dml / editor.ddl.
    const afterClosed =
      '-- @node\n-- @end\nDELETE FROM important_table WHERE id = 1';
    expect(sqlStatementCategories(afterClosed).sort()).toEqual(['dml', 'read']);
    expect(sqlStatementCategory(afterClosed)).toBe('dml');
    expect(requiresWritePermission(afterClosed)).toBe(true);
    expect(isWriteStatement(afterClosed)).toBe(true);
    expect(isMutatingDmlStatement(afterClosed)).toBe(true);

    const afterClosedDdl =
      '-- @js\nreturn 1;\n-- @end\nDROP TABLE users';
    expect(sqlStatementCategory(afterClosedDdl)).toBe('ddl');
    expect(requiresWritePermission(afterClosedDdl)).toBe(true);

    // Unclosed fence: the whole buffer is still SQL with a comment first line.
    const unclosed = '-- @node\nDELETE FROM t';
    expect(sqlStatementCategory(unclosed)).toBe('dml');
    expect(requiresWritePermission(unclosed)).toBe(true);
    expect(isWriteStatement(unclosed)).toBe(true);
    expect(statementVerb(unclosed)).toBe('delete');
  });

  it('still treats a closed code cell alone as a read (bridge owns its SQL)', () => {
    const cell = '-- @node\nreturn [{ ok: true }];\n-- @end';
    expect(sqlStatementCategories(cell)).toEqual(['read']);
    expect(requiresWritePermission(cell)).toBe(false);
    expect(isWriteStatement(cell)).toBe(false);
    expect(statementVerb(cell)).toBe('node');
  });
});
