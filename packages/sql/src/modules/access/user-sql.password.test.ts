/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Password rendering and the per-dialect create options.
 *
 * The statements built here are meant to be run by hand against a live server
 * with administrative rights, so a password that is escaped almost correctly is
 * worse than one that is refused.
 */
import { describe, expect, it } from 'vitest';
import {
  buildUserSql,
  createUserOptions,
  renderPasswordLiteral,
  PASSWORD_PLACEHOLDER,
  type UserOptions,
} from './user-sql.js';

/** Built rather than typed, so no control character sits in this file. */
const ctrl = (code: number) => String.fromCharCode(code);

describe('renderPasswordLiteral', () => {
  it('doubles an embedded quote so the literal still ends where it should', () => {
    expect(renderPasswordLiteral("a'b", 'postgres')).toEqual({ sql: "'a''b'" });
  });

  it('doubles a backslash on MySQL, which treats it as an escape', () => {
    // Postgres does not, so the same password renders differently.
    expect(renderPasswordLiteral('a\\b', 'mysql')).toEqual({ sql: "'a\\\\b'" });
    expect(renderPasswordLiteral('a\\b', 'postgres')).toEqual({ sql: "'a\\b'" });
  });

  it('refuses a double quote on Oracle rather than escaping it', () => {
    // Oracle takes the password as a quoted identifier, and a quoted identifier
    // has no escape for a double quote.
    expect('error' in renderPasswordLiteral('a"b', 'oracle')).toBe(true);
  });

  it('quotes an Oracle password the way Oracle expects', () => {
    expect(renderPasswordLiteral("a'b", 'oracle')).toEqual({ sql: `"a'b"` });
  });

  it.each([
    ['newline', 10],
    ['carriage return', 13],
    ['tab', 9],
    ['null', 0],
    ['delete', 127],
  ])('refuses a password containing a %s', (_label, code) => {
    // A line break would split the statement in two; the rest cannot survive a
    // copied statement intact.
    expect('error' in renderPasswordLiteral(`a${ctrl(code as number)}b`, 'postgres')).toBe(true);
  });

  it('refuses an empty password', () => {
    expect('error' in renderPasswordLiteral('', 'postgres')).toBe(true);
  });
});

describe('buildUserSql with a real password', () => {
  const create = (dialect: string, password?: string, options?: UserOptions) =>
    buildUserSql(
      { action: 'create', principalType: 'user', name: 'app_user', password, options },
      dialect
    );

  const DIALECTS = ['postgres', 'mysql', 'sqlserver', 'oracle', 'clickhouse', 'redshift'];

  it.each(DIALECTS)('%s writes the password instead of the placeholder', (dialect) => {
    const out = create(dialect, 'hunter2');
    expect('error' in out, dialect).toBe(false);
    if ('error' in out) return;
    const sql = out.statements.map((s) => s.sql).join('\n');
    expect(sql, dialect).toContain('hunter2');
    expect(sql, dialect).not.toContain(PASSWORD_PLACEHOLDER);
  });

  /**
   * Read a rendered literal back the way the engine would.
   *
   * Checking that the statement does not *contain* the injected text is the
   * wrong test: `'''; DROP TABLE users; --'` is a single correctly-escaped
   * literal, and the text is safely inside it. What matters is that the literal
   * ends where it should, which is exactly what parsing it back proves.
   */
  function parseLiteral(literal: string, dialect: string): string {
    if (literal.startsWith('"')) {
      // Oracle: a quoted identifier, no escapes inside.
      expect(literal.endsWith('"')).toBe(true);
      const body = literal.slice(1, -1);
      expect(body).not.toContain('"');
      return body;
    }
    expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true);
    const body = literal.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === "'") {
        // The only legal quote inside is a doubled one; a lone quote would have
        // ended the literal early.
        expect(body[i + 1], `${dialect}: unescaped quote`).toBe("'");
        out += "'";
        i++;
        continue;
      }
      if (ch === '\\' && dialect === 'mysql') {
        out += body[i + 1] ?? '';
        i++;
        continue;
      }
      out += ch;
    }
    return out;
  }

  /**
   * The literal that follows the password keyword.
   *
   * Anchored deliberately: `CREATE USER 'app_user'@'%' IDENTIFIED BY ...` opens
   * with the account name, so taking the first literal in the statement reads
   * the wrong one.
   */
  function passwordLiteral(statements: string[]): string | undefined {
    for (const sql of statements) {
      const m = sql.match(
        /(?:IDENTIFIED\s+(?:WITH\s+\w+\s+)?BY|PASSWORD\s*=|PASSWORD)\s+('(?:[^']|'')*'|"[^"]*")/i
      );
      if (m) return m[1];
    }
    return undefined;
  }

  it.each(DIALECTS)('%s renders a quote-heavy password as one closed literal', (dialect) => {
    const password = "'; DROP TABLE users; --";
    const out = create(dialect, password);
    // Refusing is also a correct answer.
    if ('error' in out) return;
    const literal = passwordLiteral(out.statements.map((s) => s.sql));
    expect(literal, `${dialect}: no password literal found`).toBeTruthy();
    // Reading it back gives the password and nothing more, so nothing escaped
    // the quotes to become SQL of its own.
    expect(parseLiteral(literal!, dialect), dialect).toBe(password);
  });

  it.each(DIALECTS)('%s round-trips a password of only quotes and backslashes', (dialect) => {
    const password = dialect === 'oracle' ? "''\\\\'" : "'\\'\\\\''";
    const out = create(dialect, password);
    if ('error' in out) return;
    const literal = passwordLiteral(out.statements.map((s) => s.sql));
    expect(literal, dialect).toBeTruthy();
    expect(parseLiteral(literal!, dialect), dialect).toBe(password);
  });

  it('refuses rather than emitting an Oracle password it cannot quote', () => {
    expect('error' in create('oracle', 'we"ird')).toBe(true);
  });

  it('warns that the SQL now carries a live secret', () => {
    const out = create('postgres', 'hunter2');
    if ('error' in out) throw new Error(out.error);
    expect(
      out.warnings.some((w) => w.level === 'danger' && /clear text/i.test(w.message))
    ).toBe(true);
  });

  it('keeps the placeholder warning when no password was given', () => {
    const out = create('postgres');
    if ('error' in out) throw new Error(out.error);
    expect(out.statements[0]!.sql).toContain(PASSWORD_PLACEHOLDER);
    expect(out.warnings.some((w) => /Replace/.test(w.message))).toBe(true);
  });
});

describe('createUserOptions', () => {
  it('offers nothing for an engine with no accounts', () => {
    for (const d of ['sqlite', 'duckdb']) expect(createUserOptions(d), d).toEqual([]);
  });

  it('offers only what the engine actually has', () => {
    const keys = (d: string) => createUserOptions(d).map((o) => o.key);
    expect(keys('postgres')).toContain('superuser');
    expect(keys('mysql')).toContain('host');
    // Postgres has no host part; MySQL has no SUPERUSER keyword.
    expect(keys('postgres')).not.toContain('host');
    expect(keys('mysql')).not.toContain('superuser');
    expect(keys('oracle')).toContain('defaultTablespace');
    expect(keys('sqlserver')).toContain('defaultDatabase');
    // Redshift is Postgres-shaped but has neither SUPERUSER nor CREATEROLE.
    expect(keys('redshift')).not.toContain('superuser');
    expect(keys('redshift')).not.toContain('createRole');
  });

  it('drops the login-shaped settings for a role', () => {
    const keys = createUserOptions('mysql', 'role').map((o) => o.key);
    expect(keys).not.toContain('host');
    expect(keys).not.toContain('mustChangePassword');
  });

  it('applies postgres attributes in the statement', () => {
    const out = buildUserSql(
      {
        action: 'create',
        principalType: 'user',
        name: 'app_user',
        options: {
          superuser: true,
          createDb: true,
          connectionLimit: 5,
          validUntil: '2027-01-01',
        },
      },
      'postgres'
    );
    if ('error' in out) throw new Error(out.error);
    const sql = out.statements[0]!.sql;
    expect(sql).toContain('SUPERUSER');
    expect(sql).toContain('CREATEDB');
    expect(sql).toContain('CONNECTION LIMIT 5');
    expect(sql).toContain("VALID UNTIL '2027-01-01'");
    expect(out.warnings.some((w) => /superuser/i.test(w.message))).toBe(true);
  });

  it('carries the policy clauses SQL Server requires with MUST_CHANGE', () => {
    // MUST_CHANGE on its own is Msg 15128.
    const out = buildUserSql(
      {
        action: 'create',
        principalType: 'user',
        name: 'app_user',
        options: { mustChangePassword: true },
      },
      'sqlserver'
    );
    if ('error' in out) throw new Error(out.error);
    const sql = out.statements[0]!.sql;
    expect(sql).toContain('MUST_CHANGE');
    expect(sql).toContain('CHECK_EXPIRATION = ON');
    expect(sql).toContain('CHECK_POLICY = ON');
  });

  it('gives an Oracle tablespace a quota, or the first insert fails', () => {
    // Without one the account owns a tablespace it cannot write to (ORA-01950).
    const out = buildUserSql(
      {
        action: 'create',
        principalType: 'user',
        name: 'app_user',
        options: { defaultTablespace: 'USERS' },
      },
      'oracle'
    );
    if ('error' in out) throw new Error(out.error);
    const sql = out.statements[0]!.sql;
    expect(sql).toContain('DEFAULT TABLESPACE "USERS"');
    expect(sql).toContain('QUOTA UNLIMITED ON "USERS"');
  });

  it('ignores an option the dialect does not offer', () => {
    // A stale value left in the form must not leak into another engine's DDL.
    const out = buildUserSql(
      {
        action: 'create',
        principalType: 'user',
        name: 'app_user',
        options: { superuser: true },
      },
      'mysql'
    );
    if ('error' in out) throw new Error(out.error);
    expect(out.statements[0]!.sql).not.toContain('SUPERUSER');
  });

  it('uses the host option as the account identity on MySQL', () => {
    const out = buildUserSql(
      {
        action: 'create',
        principalType: 'user',
        name: 'app_user',
        options: { host: 'localhost' },
      },
      'mysql'
    );
    if ('error' in out) throw new Error(out.error);
    expect(out.statements[0]!.sql).toContain("'app_user'@'localhost'");
  });
});
