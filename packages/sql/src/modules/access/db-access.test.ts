/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildDbAccessPrincipalQueries,
  buildDbAccessPrivilegeQueries,
  buildGrantRevokeSql,
  dialectSupportsDbAccess,
  formatDbGrantee,
  groupDbPrincipals,
  normalizeDbPrincipals,
  normalizeDbPrivileges,
  principalsFromPrivileges,
  privilegesForPrincipal,
  type DbPrivilege,
} from './db-access.js';

describe('dialectSupportsDbAccess', () => {
  it('supports GRANT catalogs on major engines and not SQLite', () => {
    expect(dialectSupportsDbAccess('postgres').query).toBe(true);
    expect(dialectSupportsDbAccess('mysql').grant).toBe(true);
    expect(dialectSupportsDbAccess('sqlserver').query).toBe(true);
    expect(dialectSupportsDbAccess('oracle').query).toBe(true);
    expect(dialectSupportsDbAccess('db2').query).toBe(true);
    expect(dialectSupportsDbAccess('sqlite').query).toBe(false);
    expect(dialectSupportsDbAccess('duckdb').grant).toBe(false);
    expect(dialectSupportsDbAccess('azuresql').query).toBe(true);
  });
});

describe('buildDbAccessPrincipalQueries', () => {
  it('emits pg_roles for Postgres family and mysql.user for MySQL family', () => {
    const pg = buildDbAccessPrincipalQueries({ dialect: 'postgres' });
    expect(pg[0].sql).toMatch(/pg_roles/);
    expect(pg[0].sql).toMatch(/pg_auth_members/);

    const mysql = buildDbAccessPrincipalQueries({ dialect: 'mysql' });
    expect(mysql[0].sql).toMatch(/mysql\.user/);
    expect(mysql[0].sql).toMatch(/role_edges/);

    const maria = buildDbAccessPrincipalQueries({ dialect: 'mariadb' });
    expect(maria[0].sql).toMatch(/roles_mapping/);

    const mssql = buildDbAccessPrincipalQueries({ dialect: 'sqlserver' });
    expect(mssql[0].sql).toMatch(/sys\.database_principals/);
  });

  it('falls back DBA → ALL for Oracle', () => {
    const q = buildDbAccessPrincipalQueries({ dialect: 'oracle' });
    expect(q[0].sql).toMatch(/DBA_USERS/);
    expect(q[1].sql).toMatch(/ALL_USERS/);
  });

  it('lists Db2 users from DBAUTH with a roles-only fallback', () => {
    const q = buildDbAccessPrincipalQueries({ dialect: 'db2' });
    expect(q).toHaveLength(2);
    expect(q[0].sql).toMatch(/SYSCAT\.DBAUTH/);
    expect(q[0].sql).toMatch(/CONNECTAUTH/);
    expect(q[0].sql).toMatch(/kind/);
    expect(q[1].sql).toMatch(/SYSCAT\.ROLES/);
    expect(q[1].sql).not.toMatch(/SYSCAT\.DBAUTH/);
  });
});

describe('buildDbAccessPrivilegeQueries', () => {
  it('unions table grants with role membership', () => {
    const pg = buildDbAccessPrivilegeQueries({ dialect: 'postgres' })[0].sql;
    expect(pg).toMatch(/role_table_grants/);
    expect(pg).toMatch(/pg_auth_members/);

    const mysql = buildDbAccessPrivilegeQueries({ dialect: 'mysql' })[0].sql;
    expect(mysql).toMatch(/TABLE_PRIVILEGES/);
    expect(mysql).toMatch(/SCHEMA_PRIVILEGES/);

    const db2 = buildDbAccessPrivilegeQueries({ dialect: 'db2' })[0].sql;
    expect(db2).toMatch(/SYSCAT\.TABAUTH/);
    expect(db2).toMatch(/CONNECTAUTH/);
    expect(db2).toMatch(/SYSCAT\.ROLEAUTH/);
  });
});

describe('normalizeDbPrincipals / privileges', () => {
  it('folds membership lists and maps kinds', () => {
    const principals = normalizeDbPrincipals([
      { name: 'analysts', kind: 'role', can_login: 0, member_of: '', members: 'alice,bob' },
      { NAME: 'alice', KIND: 'user', CAN_LOGIN: 1, MEMBER_OF: 'analysts', MEMBERS: '' },
    ]);
    expect(principals).toEqual([
      {
        name: 'analysts',
        kind: 'role',
        canLogin: false,
        memberOf: [],
        members: ['alice', 'bob'],
      },
      {
        name: 'alice',
        kind: 'user',
        canLogin: true,
        memberOf: ['analysts'],
        members: [],
      },
    ]);
    expect(groupDbPrincipals(principals).map((g) => [g.kind, g.principals.length])).toEqual([
      ['role', 1],
      ['user', 1],
    ]);
  });

  it('normalizes privilege rows and filters by principal', () => {
    const privs = normalizeDbPrivileges([
      {
        grantee: "'alice'@'%'",
        privilege_type: 'SELECT',
        object_type: 'TABLE',
        table_schema: 'app',
        table_name: 'orders',
        is_grantable: 'YES',
      },
      {
        GRANTEE: 'bob',
        PRIVILEGE: 'INSERT',
        OBJECT_TYPE: 'TABLE',
        OBJECT_SCHEMA: 'app',
        OBJECT_NAME: 'orders',
        GRANTABLE: 0,
      },
    ]);
    expect(privs[0]).toMatchObject({
      grantee: 'alice@%',
      privilege: 'SELECT',
      objectType: 'TABLE',
      objectSchema: 'app',
      objectName: 'orders',
      grantable: true,
    });
    expect(privilegesForPrincipal(privs, 'alice@%')).toHaveLength(1);
    expect(privilegesForPrincipal(privs, 'carol')).toHaveLength(0);
  });
});

describe('buildGrantRevokeSql', () => {
  it('builds Postgres table GRANT/REVOKE and role membership', () => {
    expect(
      buildGrantRevokeSql({
        dialect: 'postgres',
        action: 'grant',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectSchema: 'public',
        objectName: 'orders',
        grantee: 'alice',
      })
    ).toEqual({ sql: 'GRANT SELECT ON TABLE "public"."orders" TO "alice";' });

    expect(
      buildGrantRevokeSql({
        dialect: 'postgres',
        action: 'revoke',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectSchema: 'public',
        objectName: 'orders',
        grantee: 'alice',
      })
    ).toEqual({ sql: 'REVOKE SELECT ON TABLE "public"."orders" FROM "alice";' });

    expect(
      buildGrantRevokeSql({
        dialect: 'postgres',
        action: 'grant',
        privilege: 'analysts',
        objectType: 'ROLE',
        objectName: 'analysts',
        grantee: 'alice',
      })
    ).toEqual({ sql: 'GRANT "analysts" TO "alice";' });
  });

  it('formats MySQL user@host and ALL PRIVILEGES', () => {
    expect(formatDbGrantee('mysql', "alice@%")).toBe("'alice'@'%'");
    expect(
      buildGrantRevokeSql({
        dialect: 'mysql',
        action: 'grant',
        privilege: 'ALL',
        objectType: 'TABLE',
        objectSchema: 'shop',
        objectName: 'orders',
        grantee: 'alice@%',
      })
    ).toEqual({ sql: "GRANT ALL PRIVILEGES ON `shop`.`orders` TO 'alice'@'%';" });
  });

  it('defaults a bare MySQL user name to @% so GRANT matches CREATE USER', () => {
    // Add user → Grant access used to pass "report_user" without a host; the
    // emitter then produced TO `report_user`, which is not the account
    // CREATE USER 'report_user'@'%' made.
    expect(formatDbGrantee('mysql', 'report_user')).toBe("'report_user'@'%'");
    expect(formatDbGrantee('mariadb', 'report_user', 'user')).toBe("'report_user'@'%'");
    expect(formatDbGrantee('mysql', 'reporting_reader', 'role')).toBe("'reporting_reader'@'%'");
    expect(
      buildGrantRevokeSql({
        dialect: 'mysql',
        action: 'grant',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectSchema: 'app',
        objectName: 't',
        grantee: 'report_user',
      })
    ).toEqual({ sql: "GRANT SELECT ON `app`.`t` TO 'report_user'@'%';" });
  });

  it('escapes backslashes in MySQL user@host so GRANT cannot break out of the literal', () => {
    // Without doubling `\`, MySQL reads `\'` as an early end of the user literal
    // and the trailing `ice'@'%'` becomes free SQL after TO.
    const evil = "al\\'ice@%";
    expect(formatDbGrantee('mysql', evil)).toBe("'al\\\\''ice'@'%'");
    expect(formatDbGrantee('mariadb', evil)).toBe("'al\\\\''ice'@'%'");
    const grant = buildGrantRevokeSql({
      dialect: 'mysql',
      action: 'grant',
      privilege: 'SELECT',
      objectType: 'TABLE',
      objectSchema: 'shop',
      objectName: 'orders',
      grantee: evil,
    });
    expect(grant).toEqual({
      sql: "GRANT SELECT ON `shop`.`orders` TO 'al\\\\''ice'@'%';",
    });
  });

  it('uses ALTER ROLE for SQL Server membership and OBJECT:: for tables', () => {
    expect(
      buildGrantRevokeSql({
        dialect: 'sqlserver',
        action: 'grant',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectSchema: 'dbo',
        objectName: 'Orders',
        grantee: 'alice',
      })
    ).toEqual({ sql: 'GRANT SELECT ON OBJECT::[dbo].[Orders] TO [alice];' });

    expect(
      buildGrantRevokeSql({
        dialect: 'sqlserver',
        action: 'revoke',
        privilege: 'analysts',
        objectType: 'ROLE',
        objectName: 'analysts',
        grantee: 'alice',
      })
    ).toEqual({ sql: 'ALTER ROLE [analysts] DROP MEMBER [alice];' });
  });

  it('prefixes Db2 USER/GROUP and GRANT ROLE', () => {
    expect(
      buildGrantRevokeSql({
        dialect: 'db2',
        action: 'grant',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectSchema: 'APP',
        objectName: 'ORDERS',
        grantee: 'ALICE',
        granteeKind: 'user',
      })
    ).toEqual({ sql: 'GRANT SELECT ON TABLE "APP"."ORDERS" TO USER "ALICE";' });

    expect(
      buildGrantRevokeSql({
        dialect: 'db2',
        action: 'grant',
        privilege: 'ANALYSTS',
        objectType: 'ROLE',
        objectName: 'ANALYSTS',
        grantee: 'ALICE',
        granteeKind: 'user',
      })
    ).toEqual({ sql: 'GRANT ROLE "ANALYSTS" TO USER "ALICE";' });
  });

  it('emits ClickHouse GRANT without the TABLE keyword', () => {
    expect(
      buildGrantRevokeSql({
        dialect: 'clickhouse',
        action: 'grant',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectSchema: 'app',
        objectName: 'events',
        grantee: 'alice',
      })
    ).toEqual({ sql: 'GRANT SELECT ON `app`.`events` TO `alice`;' });
  });

  it('refuses SQLite', () => {
    expect(
      buildGrantRevokeSql({
        dialect: 'sqlite',
        action: 'grant',
        privilege: 'SELECT',
        objectType: 'TABLE',
        objectName: 't',
        grantee: 'x',
      })
    ).toMatchObject({ error: expect.stringMatching(/GRANT\/REVOKE/i) });
  });
});

describe('every family emits a valid clause for every object type', () => {
  /**
   * The net that has to exist before this emitter is refactored, and the test
   * that would have caught the two bugs below.
   *
   * Each family had its own copy of the emit, and a copy can quietly lose a
   * case: Db2's branch handled SCHEMA and SYSTEM and sent everything else to
   * `ON TABLE`, so a database authority came out as
   * `GRANT DBADM ON TABLE "appdb"` — not valid Db2, and a table grant instead
   * if a table of that name existed. MySQL had the mirror of it: a whole
   * database is `db`.*, and a bare `db` is a table reference.
   */
  const GRANTEE = { grantee: 'analyst', granteeKind: 'user' as const };

  const FAMILIES = ['postgres', 'mysql', 'mariadb', 'sqlserver', 'db2', 'oracle', 'clickhouse'];

  const emit = (dialect: string, objectType: string, extra: Record<string, unknown> = {}) => {
    const r = buildGrantRevokeSql({
      dialect,
      action: 'grant',
      privilege: 'SELECT',
      objectType,
      objectSchema: 'app',
      objectName: 'orders',
      ...GRANTEE,
      ...extra,
    } as never);
    if ('error' in r) throw new Error(`${dialect}/${objectType}: ${r.error}`);
    return r.sql;
  };

  it.each(FAMILIES)('%s emits a TABLE grant naming the table', (dialect) => {
    const sql = emit(dialect, 'TABLE');
    expect(sql).toMatch(/^GRANT SELECT ON /);
    expect(sql.toLowerCase()).toContain('orders');
    expect(sql.endsWith(';')).toBe(true);
  });

  it.each(FAMILIES)('%s never sends a DATABASE grant through the TABLE clause', (dialect) => {
    const sql = emit(dialect, 'DATABASE', { objectName: 'appdb', privilege: 'CONNECT' });
    expect(sql, sql).not.toMatch(/ON TABLE/i);
  });

  it.each(FAMILIES)('%s never sends a SCHEMA grant through the TABLE clause', (dialect) => {
    const sql = emit(dialect, 'SCHEMA', { objectName: 'app', privilege: 'USAGE' });
    expect(sql, sql).not.toMatch(/ON TABLE/i);
  });

  it('names a MySQL-family database as db.*, not as a bare identifier', () => {
    // `GRANT SELECT ON `appdb`` is a *table* reference in MySQL.
    for (const dialect of ['mysql', 'mariadb']) {
      expect(emit(dialect, 'DATABASE', { objectName: 'appdb' })).toContain('`appdb`.*');
    }
  });

  it('grants a Db2 database authority ON DATABASE, with no object name', () => {
    // Db2 grants database authorities on the connected database; naming one is
    // a syntax error.
    expect(emit('db2', 'DATABASE', { objectName: 'appdb', privilege: 'DBADM' })).toBe(
      'GRANT DBADM ON DATABASE TO USER "analyst";'
    );
  });

  it.each(FAMILIES)('%s pairs its GRANT with a matching REVOKE', (dialect) => {
    const granted = emit(dialect, 'TABLE');
    const revoked = buildGrantRevokeSql({
      dialect,
      action: 'revoke',
      privilege: 'SELECT',
      objectType: 'TABLE',
      objectSchema: 'app',
      objectName: 'orders',
      ...GRANTEE,
    } as never);
    if ('error' in revoked) throw new Error(revoked.error);
    expect(revoked.sql).toMatch(/^REVOKE /);
    expect(revoked.sql).toContain('FROM');
    // The object being addressed must be the same either way.
    const objectOf = (s: string) => s.replace(/^(GRANT|REVOKE)\s+\S+\s+/, '').replace(/\s+(TO|FROM)\s+.*$/, '');
    expect(objectOf(revoked.sql)).toBe(objectOf(granted));
  });

  it('grants role membership on Oracle exactly as the generic path does', () => {
    // Oracle carries a dedicated ROLE branch that emits what the fallback
    // emits; this pins the behaviour before that branch is removed.
    const oracle = buildGrantRevokeSql({
      dialect: 'oracle', action: 'grant', privilege: 'reader',
      objectType: 'ROLE', objectName: 'reader', ...GRANTEE,
    } as never);
    if ('error' in oracle) throw new Error(oracle.error);
    expect(oracle.sql).toBe('GRANT "reader" TO "analyst";');
  });
});

describe('principalsFromPrivileges', () => {
  const priv = (grantee: string, objectName = 'T'): DbPrivilege => ({
    grantee,
    privilege: 'SELECT',
    objectType: 'TABLE',
    objectSchema: 'DEMO_A',
    objectName,
    grantable: false,
    grantor: 'SYSIBM',
    state: null,
  });

  it('derives one principal per distinct grantee', () => {
    // Db2 keeps accounts in the operating system, so SYSCAT.ROLES can be empty
    // while the privilege list names real grantees.
    const out = principalsFromPrivileges([
      priv('PUBLIC'),
      priv('DB2INST1'),
      priv('PUBLIC', 'OTHER'),
    ]);
    expect(out.map((p) => p.name)).toEqual(['DB2INST1', 'PUBLIC']);
  });

  it('matches grantees case-insensitively', () => {
    const out = principalsFromPrivileges([priv('public'), priv('PUBLIC')]);
    expect(out).toHaveLength(1);
  });

  it('marks them as roles that cannot log in', () => {
    // A grantee name says nothing about whether it is an account, and claiming
    // it can log in would be an invention.
    const [only] = principalsFromPrivileges([priv('PUBLIC')]);
    expect(only!.kind).toBe('role');
    expect(only!.canLogin).toBe(false);
    expect(only!.memberOf).toEqual([]);
  });

  it('ignores blank grantees', () => {
    expect(principalsFromPrivileges([priv(''), priv('   ')])).toEqual([]);
  });
});
