import { describe, it, expect } from 'vitest';
import { splitSqlStatements, checkStatement, isWriteStatement, firstKeyword, extractTableAliases, isMutatingDmlStatement, dmlLacksWhere } from './sql-splitter';

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
  it('classifies reads and no-keyword text as non-writes', () => {
    for (const r of ['SELECT 1;', 'WITH x AS (SELECT 1) SELECT * FROM x;', 'EXPLAIN DELETE FROM t;', '???']) {
      expect(isWriteStatement(r)).toBe(false);
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
    expect(isMutatingDmlStatement('INSERT INTO t VALUES (1);')).toBe(false);
    expect(isMutatingDmlStatement('SELECT 1;')).toBe(false);
  });
  it('detects missing WHERE on UPDATE/DELETE', () => {
    expect(dmlLacksWhere('UPDATE t SET x = 1;')).toBe(true);
    expect(dmlLacksWhere('DELETE FROM t;')).toBe(true);
    expect(dmlLacksWhere('UPDATE t SET x = 1 WHERE id = 1;')).toBe(false);
    expect(dmlLacksWhere('DELETE FROM t WHERE id = 1;')).toBe(false);
    expect(dmlLacksWhere('MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE;')).toBe(false);
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
});
