/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_PLACEHOLDER,
  buildUserSql,
  buildDb2OsUserInstructions,
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
    expect(support.canDisable).toBe(true);
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

describe('buildDb2OsUserInstructions', () => {
  it('emits docker useradd, chpasswd, GRANT CONNECT, and list queries', () => {
    const out = buildDb2OsUserInstructions({ name: 'report_user' });
    if ('error' in out) throw new Error(out.error);
    const all = out.statements.map((s) => s.sql).join('\n');
    expect(all).toMatch(/foxschema-db2/);
    expect(all).toMatch(/useradd/);
    expect(all).toContain(PASSWORD_PLACEHOLDER);
    expect(all).toMatch(/GRANT CONNECT ON DATABASE TO USER REPORT_USER/);
    expect(all).toMatch(/getent passwd report_user/);
    expect(all).toMatch(/SYSCAT\.DBAUTH/);
    expect(all).toMatch(/foxdb/);
    expect(out.warnings.some((w) => w.level === 'danger' && w.message.includes(PASSWORD_PLACEHOLDER))).toBe(
      true
    );
  });

  it('emits chpasswd to update the OS password', () => {
    const out = buildDb2OsUserInstructions({ name: 'report_user', action: 'password' });
    if ('error' in out) throw new Error(out.error);
    const all = out.statements.map((s) => s.sql).join('\n');
    expect(all).toContain(`echo "report_user:${PASSWORD_PLACEHOLDER}" | chpasswd`);
    expect(all).toMatch(/passwd -S report_user/);
    expect(all).not.toMatch(/useradd/);
  });

  it('disables with passwd -l and REVOKE CONNECT, enable reverses it', () => {
    const off = buildDb2OsUserInstructions({ name: 'report_user', action: 'disable' });
    if ('error' in off) throw new Error(off.error);
    const offSql = off.statements.map((s) => s.sql).join('\n');
    expect(offSql).toMatch(/passwd -l report_user/);
    expect(offSql).toMatch(/REVOKE CONNECT ON DATABASE FROM USER REPORT_USER/);

    const on = buildDb2OsUserInstructions({ name: 'report_user', action: 'enable', database: 'SAMPLE' });
    if ('error' in on) throw new Error(on.error);
    const onSql = on.statements.map((s) => s.sql).join('\n');
    expect(onSql).toMatch(/passwd -u report_user/);
    expect(onSql).toMatch(/GRANT CONNECT ON DATABASE TO USER REPORT_USER/);
    expect(onSql).toMatch(/connect to SAMPLE/);
  });

  it('buildUserSql alter password / disable on Db2 uses the OS instructions', () => {
    const pw = buildUserSql(req({ action: 'alter', alteration: 'password' }), 'db2');
    if ('error' in pw) throw new Error(pw.error);
    expect(pw.statements.some((s) => s.sql.includes('chpasswd'))).toBe(true);

    const off = buildUserSql(req({ action: 'alter', alteration: 'disable' }), 'db2');
    if ('error' in off) throw new Error(off.error);
    expect(off.statements.some((s) => /passwd -l/.test(s.sql))).toBe(true);
  });

  it('assigns an optional role and uses the connection database', () => {
    const out = buildDb2OsUserInstructions({
      name: 'report_user',
      role: 'analysts',
      database: 'SAMPLE',
    });
    if ('error' in out) throw new Error(out.error);
    const all = out.statements.map((s) => s.sql).join('\n');
    expect(all).toMatch(/connect to SAMPLE/);
    expect(all).toMatch(/GRANT ROLE ANALYSTS TO USER REPORT_USER/);
  });

  it('rejects names that would break a docker exec line', () => {
    expect('error' in buildDb2OsUserInstructions({ name: 'report user' })).toBe(true);
    expect('error' in buildDb2OsUserInstructions({ name: '$(id)' })).toBe(true);
    expect('error' in buildDb2OsUserInstructions({ name: 'a;rm' })).toBe(true);
    expect('error' in buildDb2OsUserInstructions({ name: 'report-user' })).toBe(true);
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
    // SQL Server: do not emit runnable ALTER LOGIN with the database user name —
    // LOGIN may differ (CREATE USER app FOR LOGIN corp_app).
    const mssqlPw = buildUserSql(req({ action: 'alter', alteration: 'password' }), 'sqlserver');
    if ('error' in mssqlPw) throw new Error(mssqlPw.error);
    expect(mssqlPw.statements[0]!.sql).toMatch(/-- ALTER LOGIN <login_name> WITH PASSWORD/);
    expect(mssqlPw.statements[0]!.sql).not.toMatch(/^ALTER LOGIN/m);
    expect(mssqlPw.warnings.some((w) => /login/i.test(w.message))).toBe(true);
    expect(statements(req({ action: 'alter', alteration: 'password' }), 'postgres')[0]).toBe(
      `ALTER ROLE "report_user" WITH PASSWORD '${PASSWORD_PLACEHOLDER}';`
    );
    expect(statements(req({ action: 'alter', alteration: 'password' }), 'redshift')[0]).toBe(
      `ALTER USER "report_user" PASSWORD '${PASSWORD_PLACEHOLDER}';`
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
    const mssqlDisable = buildUserSql(req({ action: 'alter', alteration: 'disable' }), 'sqlserver');
    if ('error' in mssqlDisable) throw new Error(mssqlDisable.error);
    expect(mssqlDisable.statements[0]!.sql).toMatch(/-- ALTER LOGIN <login_name> DISABLE/);
    expect(mssqlDisable.statements[0]!.sql).not.toMatch(/^ALTER LOGIN/m);
    expect(statements(req({ action: 'alter', alteration: 'disable' }), 'redshift')[0]).toBe(
      'ALTER USER "report_user" NOLOGIN;'
    );
    expect(statements(req({ action: 'alter', alteration: 'enable' }), 'oracle')[0]).toBe(
      'ALTER USER "report_user" ACCOUNT UNLOCK;'
    );
    expect(statements(req({ action: 'alter', alteration: 'enable' }), 'redshift')[0]).toBe(
      `ALTER USER "report_user" LOGIN PASSWORD '${PASSWORD_PLACEHOLDER}';`
    );
  });

  it('does not guess SQL Server LOGIN for expire either', () => {
    const out = buildUserSql(req({ action: 'alter', alteration: 'expire' }), 'sqlserver');
    if ('error' in out) throw new Error(out.error);
    expect(out.statements[0]!.sql).toMatch(/-- ALTER LOGIN <login_name> WITH CHECK_EXPIRATION ON/);
    expect(out.statements[0]!.sql).not.toMatch(/^ALTER LOGIN/m);
    expect(out.warnings.some((w) => /login/i.test(w.message))).toBe(true);
  });

  it('renames, and refuses where the engine cannot', () => {
    expect(
      statements(req({ action: 'alter', alteration: 'rename', newName: 'rpt' }), 'mysql')[0]
    ).toBe(`RENAME USER 'report_user'@'%' TO 'rpt'@'%';`);
    expect(
      statements(req({ action: 'alter', alteration: 'rename', newName: 'rpt' }), 'postgres')[0]
    ).toBe('ALTER USER "report_user" RENAME TO "rpt";');
    expect(
      statements(req({ action: 'alter', alteration: 'rename', newName: 'rpt' }), 'redshift')[0]
    ).toBe('ALTER USER "report_user" RENAME TO "rpt";');

    const oracle = buildUserSql(
      req({ action: 'alter', alteration: 'rename', newName: 'RPT' }),
      'oracle'
    );
    expect('error' in oracle).toBe(true);

    const redshiftGroup = buildUserSql(
      req({
        action: 'alter',
        alteration: 'rename',
        newName: 'other',
        principalType: 'role',
        name: 'analysts',
      }),
      'redshift'
    );
    expect('error' in redshiftGroup).toBe(true);
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

  it('expire on redshift uses ALTER USER PASSWORD … VALID UNTIL', () => {
    expect(
      statements(
        req({ action: 'alter', alteration: 'expire', validUntil: '2027-01-01' }),
        'redshift'
      )[0]
    ).toBe(
      `ALTER USER "report_user" PASSWORD '${PASSWORD_PLACEHOLDER}' VALID UNTIL '2027-01-01';`
    );
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
  it('drops the database user on SQL Server without guessing the login name', () => {
    expect(statements(req({ action: 'drop' }), 'sqlserver')).toEqual([
      'DROP USER [report_user];',
    ]);
    const out = buildUserSql(req({ action: 'drop' }), 'sqlserver');
    if ('error' in out) throw new Error(out.error);
    expect(out.warnings.some((w) => /login/i.test(w.message))).toBe(true);
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
