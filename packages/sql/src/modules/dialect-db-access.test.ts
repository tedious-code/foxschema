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
  privilegesForPrincipal,
} from './dialect-db-access.js';

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
});

describe('buildDbAccessPrivilegeQueries', () => {
  it('unions table grants with role membership', () => {
    const pg = buildDbAccessPrivilegeQueries({ dialect: 'postgres' })[0].sql;
    expect(pg).toMatch(/role_table_grants/);
    expect(pg).toMatch(/pg_auth_members/);

    const mysql = buildDbAccessPrivilegeQueries({ dialect: 'mysql' })[0].sql;
    expect(mysql).toMatch(/TABLE_PRIVILEGES/);
    expect(mysql).toMatch(/SCHEMA_PRIVILEGES/);
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
