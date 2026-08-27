/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_PLACEHOLDER,
  buildUserSql,
  userManagementSupport,
  type UserRequest,
} from './user-sql.js';
import { resolveUserSql, USER_SQL_MAP } from './user-sql.registry.js';
import { DIALECT_MAP } from '../dialect/registry.js';

const req = (over: Partial<UserRequest> = {}): UserRequest => ({
  action: 'create',
  principalType: 'user',
  name: 'report_user',
  ...over,
});

/** The statements, or a failing assertion if the build was refused. */
function statements(request: UserRequest, dialect: string): string[] {
  const out = buildUserSql(request, dialect);
  if ('error' in out) throw new Error(`${dialect}: ${out.error}`);
  return out.statements.map((s) => s.sql);
}

describe('userManagementSupport', () => {
  it('answers for every registered dialect', () => {
    for (const dialect of Object.keys(DIALECT_MAP)) {
      const support = userManagementSupport(dialect);
      expect(typeof support.supported, dialect).toBe('boolean');
      if (!support.supported || !support.canCreateUser) {
        // The UI shows this instead of a disabled control with no explanation.
        expect(support.reason, dialect).toBeTruthy();
      }
    }
  });

  it('has no accounts for the file-backed engines', () => {
    for (const dialect of ['sqlite', 'duckdb']) {
      expect(userManagementSupport(dialect).supported, dialect).toBe(false);
    }
  });

  it('lets Db2 manage roles but not users', () => {
    const support = userManagementSupport('db2');
    expect(support.supported).toBe(true);
    expect(support.canCreateUser).toBe(false);
    expect(support.canCreateRole).toBe(true);
    expect(support.reason).toMatch(/operating system|directory/i);
  });

  it('treats an unknown dialect as unsupported (no Postgres fallback)', () => {
    const support = userManagementSupport('not-a-real-engine');
    expect(support.supported).toBe(false);
    expect(support.reason).toBeTruthy();
  });
});

describe('user-sql registry', () => {
  it('registers every migration dialect id', () => {
    for (const dialect of Object.keys(DIALECT_MAP)) {
      expect(USER_SQL_MAP[dialect.toLowerCase()], dialect).toBeTruthy();
      expect(resolveUserSql(dialect).support).toEqual(userManagementSupport(dialect));
    }
  });

  it('aliases azuresql to sqlserver create shape', () => {
    expect(statements(req(), 'azuresql')).toEqual(statements(req(), 'sqlserver'));
  });

  it('aliases mariadb and tidb to mysql create shape', () => {
    expect(statements(req(), 'mariadb')).toEqual(statements(req(), 'mysql'));
    expect(statements(req(), 'tidb')).toEqual(statements(req(), 'mysql'));
  });

  it('aliases cockroachdb and yugabytedb to postgres create shape', () => {
    expect(statements(req(), 'cockroachdb')).toEqual(statements(req(), 'postgres'));
    expect(statements(req(), 'yugabytedb')).toEqual(statements(req(), 'postgres'));
  });

  it('keeps redshift distinct from postgres ROLE', () => {
    expect(statements(req({ principalType: 'role', name: 'analysts' }), 'redshift')).toEqual([
      'CREATE GROUP "analysts";',
    ]);
    expect(statements(req({ principalType: 'role', name: 'analysts' }), 'postgres')).toEqual([
      'CREATE ROLE "analysts";',
    ]);
  });
});

describe('buildUserSql — create', () => {
  it('creates a Postgres user as a role with LOGIN', () => {
    expect(statements(req(), 'postgres')).toEqual([
      `CREATE ROLE "report_user" WITH LOGIN PASSWORD '${PASSWORD_PLACEHOLDER}';`,
    ]);
  });

  it('creates a Postgres role without LOGIN', () => {
    expect(statements(req({ principalType: 'role', name: 'reporting' }), 'postgres')).toEqual([
      'CREATE ROLE "reporting";',
    ]);
  });

  it('creates a MySQL account for a specific host', () => {
    expect(statements(req({ host: 'localhost' }), 'mysql')).toEqual([
      `CREATE USER 'report_user'@'localhost' IDENTIFIED BY '${PASSWORD_PLACEHOLDER}';`,
    ]);
    // No host means any host, which is what MySQL itself defaults to.
    expect(statements(req(), 'mysql')[0]).toContain("@'%'");
  });

  it('creates a MariaDB user with MySQL syntax, not Postgres ROLE', () => {
    const sql = statements(req(), 'mariadb');
    expect(sql[0]).toBe(
      `CREATE USER 'report_user'@'%' IDENTIFIED BY '${PASSWORD_PLACEHOLDER}';`
    );
    expect(sql.join('\n')).not.toMatch(/CREATE ROLE/i);
    expect(sql.join('\n')).not.toMatch(/WITH LOGIN/i);
  });

  it('creates both a login and a user on SQL Server', () => {
    const sql = statements(req(), 'sqlserver');
    expect(sql).toEqual([
      `CREATE LOGIN [report_user] WITH PASSWORD = '${PASSWORD_PLACEHOLDER}';`,
      'CREATE USER [report_user] FOR LOGIN [report_user];',
    ]);
    const out = buildUserSql(req(), 'sqlserver');
    if ('error' in out) throw new Error(out.error);
    // Each runs against a different database, so the UI has to say which.
    expect(out.warnings.some((w) => /master/i.test(w.message))).toBe(true);
  });

  it('grants CREATE SESSION on Oracle, without which the account cannot log in', () => {
    expect(statements(req({ name: 'REPORT_USER' }), 'oracle')).toEqual([
      `CREATE USER "REPORT_USER" IDENTIFIED BY "${PASSWORD_PLACEHOLDER}";`,
      'GRANT CREATE SESSION TO "REPORT_USER";',
    ]);
  });

  it('refuses to create a user on Db2 and explains why', () => {
    const out = buildUserSql(req(), 'db2');
    expect('error' in out).toBe(true);
    if (!('error' in out)) return;
    expect(out.error).toMatch(/operating system|directory/i);
  });

  it('creates a Db2 role, which Db2 does own', () => {
    expect(statements(req({ principalType: 'role', name: 'REPORTING' }), 'db2')).toEqual([
      'CREATE ROLE "REPORTING";',
    ]);
  });

  it('uses GROUP on Redshift, which has no ROLE', () => {
    expect(statements(req({ principalType: 'role', name: 'analysts' }), 'redshift')).toEqual([
      'CREATE GROUP "analysts";',
    ]);
  });

  it('refuses on an engine with no accounts', () => {
    for (const dialect of ['sqlite', 'duckdb']) {
      const out = buildUserSql(req(), dialect);
      expect('error' in out, dialect).toBe(true);
    }
  });
});

describe('buildUserSql — passwords are never handled', () => {
  it('emits a placeholder and warns to replace it', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlserver', 'oracle', 'clickhouse']) {
      const out = buildUserSql(req(), dialect);
      if ('error' in out) throw new Error(`${dialect}: ${out.error}`);
      const all = out.statements.map((s) => s.sql).join('\n');
      expect(all, dialect).toContain(PASSWORD_PLACEHOLDER);
      expect(
        out.warnings.some((w) => w.level === 'danger' && w.message.includes(PASSWORD_PLACEHOLDER)),
        dialect
      ).toBe(true);
    }
  });

  it('takes no password argument at all', () => {
    // The request type has no password field, so there is no path by which one
    // could reach a statement, a store or a history record.
    expect(Object.keys(req())).not.toContain('password');
  });
});

describe('buildUserSql — alter', () => {
  it('sets a password per engine', () => {
    expect(statements(req({ action: 'alter', alteration: 'password' }), 'mysql')[0]).toBe(
      `ALTER USER 'report_user'@'%' IDENTIFIED BY '${PASSWORD_PLACEHOLDER}';`
    );
    expect(statements(req({ action: 'alter', alteration: 'password' }), 'sqlserver')[0]).toBe(
      `ALTER LOGIN [report_user] WITH PASSWORD = '${PASSWORD_PLACEHOLDER}';`
    );
    expect(statements(req({ action: 'alter', alteration: 'password' }), 'postgres')[0]).toBe(
      `ALTER ROLE "report_user" WITH PASSWORD '${PASSWORD_PLACEHOLDER}';`
    );
  });

  it('refuses a password on a role', () => {
    const out = buildUserSql(
      req({ action: 'alter', alteration: 'password', principalType: 'role' }),
      'postgres'
    );
    expect('error' in out).toBe(true);
  });

  it('disables an account rather than dropping it', () => {
    expect(statements(req({ action: 'alter', alteration: 'disable' }), 'postgres')[0]).toBe(
      'ALTER ROLE "report_user" NOLOGIN;'
    );
    expect(statements(req({ action: 'alter', alteration: 'disable' }), 'mysql')[0]).toBe(
      `ALTER USER 'report_user'@'%' ACCOUNT LOCK;`
    );
    expect(statements(req({ action: 'alter', alteration: 'disable' }), 'sqlserver')[0]).toBe(
      'ALTER LOGIN [report_user] DISABLE;'
    );
    expect(statements(req({ action: 'alter', alteration: 'enable' }), 'oracle')[0]).toBe(
      'ALTER USER "report_user" ACCOUNT UNLOCK;'
    );
  });

  it('renames, and refuses where the engine cannot', () => {
    expect(
      statements(req({ action: 'alter', alteration: 'rename', newName: 'rpt' }), 'mysql')[0]
    ).toBe(`RENAME USER 'report_user'@'%' TO 'rpt'@'%';`);
    expect(
      statements(req({ action: 'alter', alteration: 'rename', newName: 'rpt' }), 'postgres')[0]
    ).toBe('ALTER USER "report_user" RENAME TO "rpt";');

    const oracle = buildUserSql(
      req({ action: 'alter', alteration: 'rename', newName: 'RPT' }),
      'oracle'
    );
    expect('error' in oracle).toBe(true);
  });

  it('needs the new name before it will rename', () => {
    const out = buildUserSql(req({ action: 'alter', alteration: 'rename' }), 'postgres');
    expect('error' in out).toBe(true);
  });

  it('expire on postgres uses VALID UNTIL', () => {
    expect(
      statements(
        req({ action: 'alter', alteration: 'expire', validUntil: '2027-01-01' }),
        'postgres'
      )[0]
    ).toBe(`ALTER ROLE "report_user" VALID UNTIL '2027-01-01';`);
  });

  it('expire on postgres escapes quotes in VALID UNTIL', () => {
    const evil = "2027-01-01'; DROP ROLE admin; --";
    expect(
      statements(req({ action: 'alter', alteration: 'expire', validUntil: evil }), 'postgres')[0]
    ).toBe(`ALTER ROLE "report_user" VALID UNTIL '2027-01-01''; DROP ROLE admin; --';`);
  });

  it('expire on mysql uses PASSWORD EXPIRE INTERVAL', () => {
    expect(
      statements(req({ action: 'alter', alteration: 'expire', validUntil: '90' }), 'mysql')[0]
    ).toBe(`ALTER USER 'report_user'@'%' PASSWORD EXPIRE INTERVAL 90 DAY;`);
  });

  it('expire on mysql rejects a non-numeric interval', () => {
    const out = buildUserSql(
      req({ action: 'alter', alteration: 'expire', validUntil: "1; DROP USER 'x'@'%';--" }),
      'mysql'
    );
    expect('error' in out).toBe(true);
  });
});

describe('buildUserSql — drop', () => {
  it('drops both objects on SQL Server', () => {
    expect(statements(req({ action: 'drop' }), 'sqlserver')).toEqual([
      'DROP USER [report_user];',
      'DROP LOGIN [report_user];',
    ]);
  });

  it('makes Oracle CASCADE an explicit choice', () => {
    expect(statements(req({ action: 'drop' }), 'oracle')[0]).toBe('DROP USER "report_user";');
    expect(statements(req({ action: 'drop', cascade: true }), 'oracle')[0]).toBe(
      'DROP USER "report_user" CASCADE;'
    );
    const cascaded = buildUserSql(req({ action: 'drop', cascade: true }), 'oracle');
    if ('error' in cascaded) throw new Error(cascaded.error);
    // Dropping every object the account owns is not recoverable.
    expect(cascaded.statements[0]!.risk).toBe('critical');
  });

  it('warns that Postgres will refuse while the account owns anything', () => {
    const out = buildUserSql(req({ action: 'drop' }), 'postgres');
    if ('error' in out) throw new Error(out.error);
    expect(out.warnings.some((w) => /REASSIGN OWNED/.test(w.message))).toBe(true);
  });
});

describe('buildUserSql — quoting', () => {
  it('quotes a name that would otherwise change the statement', () => {
    const evil = 'bad"; DROP TABLE users--';
    const pg = statements(req({ name: evil }), 'postgres')[0]!;
    expect(pg).toContain('"bad""; DROP TABLE users--"');
    // The doubled quote keeps the injection inside the identifier.
    expect(pg.endsWith(`PASSWORD '${PASSWORD_PLACEHOLDER}';`)).toBe(true);

    const my = statements(req({ name: "o'brien" }), 'mysql')[0]!;
    expect(my).toContain("'o''brien'@'%'");
  });

  it('escapes backslashes in the MySQL host part of an account', () => {
    const sql = statements(req({ name: 'app_user', host: "x\\'" }), 'mysql')[0]!;
    // Without doubling `\`, MySQL would read `\'` as an early end of the host literal.
    expect(sql).toContain("'app_user'@'x\\\\'''");
  });

  it('rejects an empty name', () => {
    expect('error' in buildUserSql(req({ name: '   ' }), 'postgres')).toBe(true);
  });
});
