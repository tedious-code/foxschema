/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dialect-aware catalog probes and GRANT/REVOKE SQL for SQL Editor →
 * Database Access (also embedded in Access control).
 *
 * Quality ladder mirrors index fragmentation: native catalogs when available,
 * a simpler information_schema fallback next, unsupported for engines with no
 * GRANT (SQLite / DuckDB).
 */

import { quoteSqlIdentifier } from '../sql-text/sql-template.js';
import { accessFamily } from './intent.js';

export type DbAccessProbeMode = 'native' | 'estimated' | 'unsupported';

export interface DbAccessSupport {
  mode: DbAccessProbeMode;
  query: boolean;
  grant: boolean;
  hint: string;
}

export interface DbAccessQuery {
  sql: string;
  params: unknown[];
}

export type DbPrincipalKind = 'user' | 'role' | 'group';

export interface DbPrincipal {
  name: string;
  kind: DbPrincipalKind;
  canLogin: boolean | null;
  /** Roles/groups this principal belongs to. */
  memberOf: string[];
  /** Members when this principal is a role/group. */
  members: string[];
}

export type DbPrivilegeObjectType = 'TABLE' | 'SCHEMA' | 'DATABASE' | 'ROLE' | 'SYSTEM' | 'COLUMN' | 'OTHER';

export interface DbPrivilege {
  grantee: string;
  privilege: string;
  objectType: DbPrivilegeObjectType;
  objectSchema: string | null;
  objectName: string | null;
  grantable: boolean;
  grantor: string | null;
  /** SQL Server DENY vs GRANT. Null on engines without DENY. */
  state: 'grant' | 'deny' | null;
}

export interface DbAccessGrantArgs {
  dialect: string;
  action: 'grant' | 'revoke';
  privilege: string;
  objectType: DbPrivilegeObjectType | string;
  objectSchema?: string | null;
  objectName?: string | null;
  grantee: string;
  granteeKind?: DbPrincipalKind;
  withGrantOption?: boolean;
}

export const DB_OBJECT_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'REFERENCES',
  'USAGE',
  'EXECUTE',
  'ALL',
] as const;

const UNSUPPORTED: DbAccessSupport = {
  mode: 'unsupported',
  query: false,
  grant: false,
  hint: 'This dialect has no GRANT/REVOKE catalog — access is file- or engine-level.',
};

/**
 * One family map for both access surfaces — this used to be a second copy of
 * `accessFamily`, which is exactly how two views of the same engine drift.
 */
const family = accessFamily;

const SUPPORT: Record<string, DbAccessSupport> = {
  postgres: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'PostgreSQL: pg_roles / pg_auth_members and information_schema table/schema grants.',
  },
  cockroachdb: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'CockroachDB: PostgreSQL-compatible role and privilege catalogs.',
  },
  yugabytedb: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'YugabyteDB: PostgreSQL-compatible role and privilege catalogs.',
  },
  redshift: {
    mode: 'estimated',
    query: true,
    grant: true,
    hint: 'Redshift: pg_roles plus information_schema grants (some system grants are hidden).',
  },
  mysql: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'MySQL: mysql.user / mysql.role_edges and INFORMATION_SCHEMA TABLE/SCHEMA_PRIVILEGES.',
  },
  mariadb: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'MariaDB: mysql.user / mysql.roles_mapping and INFORMATION_SCHEMA TABLE/SCHEMA_PRIVILEGES.',
  },
  tidb: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'TiDB: MySQL-compatible user and privilege catalogs.',
  },
  sqlserver: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'SQL Server: sys.database_principals, database_role_members, database_permissions.',
  },
  azuresql: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'Azure SQL: same database principal and permission views as SQL Server.',
  },
  oracle: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'Oracle: DBA_USERS / DBA_ROLES / DBA_TAB_PRIVS (falls back to ALL_*).',
  },
  db2: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'Db2: SYSCAT.ROLES, ROLEAUTH, TABAUTH.',
  },
  clickhouse: {
    mode: 'native',
    query: true,
    grant: true,
    hint: 'ClickHouse: system.users, system.roles, system.grants.',
  },
  sqlite: UNSUPPORTED,
  duckdb: UNSUPPORTED,
};

export function dialectSupportsDbAccess(dialect: string): DbAccessSupport {
  return SUPPORT[family(dialect)] ?? {
    mode: 'estimated',
    query: true,
    grant: true,
    hint: 'Generic information_schema.TABLE_PRIVILEGES probe. GRANT SQL uses quoted identifiers.',
  };
}

/** Ordered catalog probes — backend tries each until one succeeds. */
export function buildDbAccessPrincipalQueries(opts: {
  dialect: string;
  schema?: string;
}): DbAccessQuery[] {
  const fam = family(opts.dialect);
  if (fam === 'postgres') return [{ sql: PG_PRINCIPALS, params: [] }];
  if (fam === 'mysql') return [{ sql: MYSQL_PRINCIPALS, params: [] }, { sql: MYSQL_PRINCIPALS_FALLBACK, params: [] }];
  if (fam === 'mariadb') {
    return [
      { sql: MARIADB_PRINCIPALS, params: [] },
      { sql: MYSQL_PRINCIPALS, params: [] },
      { sql: MYSQL_PRINCIPALS_FALLBACK, params: [] },
    ];
  }
  if (fam === 'sqlserver') return [{ sql: MSSQL_PRINCIPALS, params: [] }];
  if (fam === 'oracle') {
    return [{ sql: ORACLE_PRINCIPALS_DBA, params: [] }, { sql: ORACLE_PRINCIPALS_ALL, params: [] }];
  }
  if (fam === 'db2') return [{ sql: DB2_PRINCIPALS, params: [] }];
  if (fam === 'clickhouse') return [{ sql: CLICKHOUSE_PRINCIPALS, params: [] }];
  return [{ sql: GENERIC_PRINCIPALS, params: [] }];
}

export function buildDbAccessPrivilegeQueries(opts: {
  dialect: string;
  schema?: string;
}): DbAccessQuery[] {
  const fam = family(opts.dialect);
  const schema = (opts.schema ?? '').trim();
  if (fam === 'postgres') return [{ sql: PG_PRIVILEGES, params: [] }];
  if (fam === 'mysql' || fam === 'mariadb') {
    return schema
      ? [{ sql: MYSQL_PRIVILEGES_SCHEMA, params: [schema, schema] }, { sql: MYSQL_PRIVILEGES, params: [] }]
      : [{ sql: MYSQL_PRIVILEGES, params: [] }];
  }
  if (fam === 'sqlserver') return [{ sql: MSSQL_PRIVILEGES, params: [] }];
  if (fam === 'oracle') {
    return [{ sql: ORACLE_PRIVILEGES_DBA, params: [] }, { sql: ORACLE_PRIVILEGES_ALL, params: [] }];
  }
  if (fam === 'db2') return [{ sql: DB2_PRIVILEGES, params: [] }];
  if (fam === 'clickhouse') return [{ sql: CLICKHOUSE_PRIVILEGES, params: [] }];
  return [{ sql: GENERIC_PRIVILEGES, params: [] }];
}

export function normalizeDbPrincipals(rows: ReadonlyArray<Record<string, unknown>>): DbPrincipal[] {
  const out: DbPrincipal[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = stripQuotes(asString(pick(row, 'name', 'rolname', 'username', 'user_name', 'grantee')));
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      kind: normalizeKind(pick(row, 'kind', 'type_desc', 'type', 'granteetype')),
      canLogin: asBool(pick(row, 'can_login', 'rolcanlogin', 'canlogin')),
      memberOf: splitList(asString(pick(row, 'member_of', 'memberof'))),
      members: splitList(asString(pick(row, 'members', 'member'))),
    });
  }
  return out;
}

export function normalizeDbPrivileges(rows: ReadonlyArray<Record<string, unknown>>): DbPrivilege[] {
  const out: DbPrivilege[] = [];
  for (const row of rows) {
    const grantee = stripQuotes(asString(pick(row, 'grantee', 'user_name', 'role_name', 'grantee_name')));
    const privilege = asString(pick(row, 'privilege', 'privilege_type', 'permission_name', 'access_type', 'granted_role'));
    if (!grantee || !privilege) continue;
    const stateRaw = asString(pick(row, 'state', 'state_desc')).toLowerCase();
    out.push({
      grantee,
      privilege,
      objectType: normalizeObjectType(pick(row, 'object_type', 'class_desc', 'objecttype')),
      objectSchema: emptyToNull(asString(pick(row, 'object_schema', 'table_schema', 'owner', 'database', 'tabschema'))),
      objectName: emptyToNull(asString(pick(row, 'object_name', 'table_name', 'tabname', 'table'))),
      grantable: asBool(pick(row, 'grantable', 'is_grantable', 'grant_option', 'admin_option')) === true,
      grantor: emptyToNull(stripQuotes(asString(pick(row, 'grantor')))),
      state: stateRaw.includes('deny') ? 'deny' : stateRaw ? 'grant' : null,
    });
  }
  return out;
}

/**
 * Principals inferred from the grantees named in a privilege list.
 *
 * Db2 has no user catalog — accounts live in the operating system or a
 * directory service, and `SYSCAT.ROLES` holds only roles. An instance with no
 * user-defined roles therefore returns no principals at all, while the
 * privilege list still names real grantees such as PUBLIC and the instance
 * owner. Without this the panel shows privileges belonging to principals it
 * cannot list, and none of them can be selected to see what they hold.
 *
 * Used only as a fallback: a catalog that answers is always preferred, because
 * it also carries `canLogin` and role membership, which a grantee name cannot.
 */
export function principalsFromPrivileges(privileges: readonly DbPrivilege[]): DbPrincipal[] {
  const byName = new Map<string, DbPrincipal>();
  for (const priv of privileges) {
    const name = priv.grantee?.trim();
    if (!name) continue;
    const key = name.toUpperCase();
    if (byName.has(key)) continue;
    byName.set(key, {
      name,
      // A grantee name does not say whether it is a user or a role. `role` is
      // the safer read: it describes something that holds privileges, which is
      // all that is known here, and it keeps these out of the Users group where
      // a reader would expect an account that can log in.
      kind: 'role',
      canLogin: false,
      memberOf: [],
      members: [],
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function privilegesForPrincipal(
  privileges: readonly DbPrivilege[],
  principal: string
): DbPrivilege[] {
  const key = stripQuotes(principal).toLowerCase();
  return privileges.filter((p) => stripQuotes(p.grantee).toLowerCase() === key);
}

export function groupDbPrincipals(principals: readonly DbPrincipal[]): Array<{
  kind: 'role' | 'user';
  label: string;
  principals: DbPrincipal[];
}> {
  const roles = principals.filter((p) => p.kind === 'role' || p.kind === 'group');
  const users = principals.filter((p) => p.kind === 'user');
  return [
    { kind: 'role', label: 'Roles & groups', principals: roles },
    { kind: 'user', label: 'Users', principals: users },
  ];
}

/** Quote a principal for GRANT/REVOKE (MySQL `'user'@'host'`, Db2 `USER "x"`). */
export function formatDbGrantee(
  dialect: string,
  name: string,
  kind: DbPrincipalKind = 'user'
): string {
  const fam = family(dialect);
  const raw = stripQuotes(name);
  if (fam === 'mysql' || fam === 'mariadb') {
    // Same escaping as account DDL in user-sql: MySQL treats `\` as an escape
    // inside string literals, so a name like `al\'ice` would otherwise close
    // the quote early and turn the rest of the GRANT into free SQL. Double
    // backslashes before doubling quotes.
    const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    const at = raw.lastIndexOf('@');
    if (at > 0) {
      return `${quote(raw.slice(0, at))}@${quote(raw.slice(at + 1))}`;
    }
    // MySQL accounts are name@host. A bare name used to become `` `alice` ``,
    // which is not a user account — CREATE USER / our catalog use 'alice'@'%',
    // and GRANT TO `alice` either fails or hits a role of that name instead.
    // Default the host for users (and for roles our DDL creates as name@'%').
    if (kind === 'user' || kind === 'role') {
      return `${quote(raw)}@'%'`;
    }
    return quoteSqlIdentifier(raw, dialect);
  }
  const ident = quoteSqlIdentifier(raw, dialect);
  if (fam === 'db2') {
    const prefix = kind === 'group' ? 'GROUP' : kind === 'role' ? 'ROLE' : 'USER';
    return `${prefix} ${ident}`;
  }
  return ident;
}

/**
 * The one shape every engine's GRANT and REVOKE share.
 *
 * Each family used to write this ternary out for itself — nine copies, varying
 * only in the ON clause. That is how Db2 came to omit DATABASE and emit
 * `ON TABLE` for a database authority: the case was handled in the generic
 * copy and missing from Db2's own. One emitter, and a family can only get its
 * ON clause wrong, not the statement around it.
 *
 * `on` is empty for privileges that take no object — a Db2 or SQL Server
 * system authority, or role membership.
 */
function emitGrant(opts: {
  action: 'grant' | 'revoke';
  privilege: string;
  on: string;
  grantee: string;
  /** Only ever set when granting; REVOKE has no such clause. */
  grantOption?: string;
}): { sql: string } {
  const on = opts.on ? ` ${opts.on}` : '';
  return {
    sql:
      opts.action === 'grant'
        ? `GRANT ${opts.privilege}${on} TO ${opts.grantee}${opts.grantOption ?? ''};`
        : `REVOKE ${opts.privilege}${on} FROM ${opts.grantee};`,
  };
}

export function buildGrantRevokeSql(args: DbAccessGrantArgs): { sql: string } | { error: string } {
  const support = dialectSupportsDbAccess(args.dialect);
  if (!support.grant) {
    return { error: support.hint || 'This dialect does not support GRANT/REVOKE.' };
  }
  const privilege = (args.privilege || '').trim();
  const grantee = (args.grantee || '').trim();
  if (!privilege) return { error: 'privilege is required.' };
  if (!grantee) return { error: 'grantee is required.' };

  const fam = family(args.dialect);
  const objectType = String(args.objectType || 'TABLE').toUpperCase();
  const ident = (name: string) => quoteSqlIdentifier(name, args.dialect);
  const granteeSql = formatDbGrantee(args.dialect, grantee, args.granteeKind ?? 'user');
  const objectSql = qualifyObject(args.dialect, objectType, args.objectSchema, args.objectName);
  const privSql = privilegeSql(fam, privilege);
  const action = args.action === 'grant' ? 'grant' : 'revoke';
  const grantOption = action === 'grant' && args.withGrantOption ? grantOptionClause(fam) : '';
  /** The schema or database being addressed, for the clauses that name one. */
  const namedObject = () => ident(args.objectName || args.objectSchema || '');

  // --- Role membership -----------------------------------------------------
  if (objectType === 'ROLE') {
    const roleName = (args.objectName || privilege).trim();
    if (!roleName) return { error: 'role name is required.' };
    const roleSql = ident(roleName);
    // SQL Server does not grant a role, it adds a member to one.
    if (fam === 'sqlserver') {
      const member = ident(stripQuotes(grantee));
      return {
        sql:
          action === 'grant'
            ? `ALTER ROLE ${roleSql} ADD MEMBER ${member};`
            : `ALTER ROLE ${roleSql} DROP MEMBER ${member};`,
      };
    }
    // Db2 names the object kind; every other engine grants the role directly,
    // Oracle included — it had its own branch emitting exactly this.
    return emitGrant({
      action,
      privilege: fam === 'db2' ? `ROLE ${roleSql}` : roleSql,
      on: '',
      grantee: granteeSql,
    });
  }

  if (!objectSql && objectType !== 'SYSTEM' && objectType !== 'DATABASE') {
    return { error: 'object name is required.' };
  }

  // --- Object privileges: each family supplies only its ON clause ----------
  if (fam === 'sqlserver') {
    // SQL Server scopes with a securable prefix rather than a keyword.
    const on =
      objectType === 'SYSTEM'
        ? ''
        : objectType === 'DATABASE'
          ? `ON DATABASE::${namedObject()}`
          : objectType === 'SCHEMA'
            ? `ON SCHEMA::${namedObject()}`
            : `ON OBJECT::${objectSql}`;
    return emitGrant({ action, privilege: privSql, on, grantee: granteeSql, grantOption });
  }

  if (fam === 'mysql' || fam === 'mariadb') {
    // MySQL names a whole database as `db`.* — a bare `db` is a table
    // reference, so a database-level grant landed on a table of that name.
    const target =
      objectType === 'DATABASE' || objectType === 'SCHEMA'
        ? `${objectSql || namedObject()}.*`
        : objectSql || '*.*';
    return emitGrant({
      action,
      privilege: privSql === 'ALL' ? 'ALL PRIVILEGES' : privSql,
      on: `ON ${target}`,
      grantee: granteeSql,
      grantOption,
    });
  }

  if (fam === 'clickhouse') {
    // ClickHouse takes no object keyword; `db.table` or `db.*` is the target.
    return emitGrant({
      action,
      privilege: privSql,
      on: `ON ${objectSql || '*.*'}`,
      grantee: granteeSql,
      grantOption,
    });
  }

  // Postgres, Oracle and Db2 share the keyword form; Db2 differs only in that
  // a database authority is granted ON DATABASE with no object named.
  const on =
    objectType === 'SYSTEM'
      ? ''
      : objectType === 'SCHEMA'
        ? `ON SCHEMA ${namedObject()}`
        : objectType === 'DATABASE'
          ? fam === 'db2'
            ? 'ON DATABASE'
            : `ON DATABASE ${namedObject()}`
          : `ON TABLE ${objectSql}`;
  return emitGrant({ action, privilege: privSql, on, grantee: granteeSql, grantOption });
}

function privilegeSql(fam: string, privilege: string): string {
  const p = privilege.trim().toUpperCase();
  if (p === 'ALL' && (fam === 'mysql' || fam === 'mariadb')) return 'ALL';
  if (p === 'ALL' && fam === 'sqlserver') {
    return 'SELECT, INSERT, UPDATE, DELETE, REFERENCES, ALTER';
  }
  return p;
}

function grantOptionClause(fam: string): string {
  if (fam === 'sqlserver') return ' WITH GRANT OPTION';
  return ' WITH GRANT OPTION';
}

function qualifyObject(
  dialect: string,
  objectType: string,
  schema: string | null | undefined,
  name: string | null | undefined
): string {
  const ident = (n: string) => quoteSqlIdentifier(n, dialect);
  const s = (schema ?? '').trim();
  const n = (name ?? '').trim();
  if (objectType === 'SCHEMA' || objectType === 'DATABASE') {
    return ident(n || s);
  }
  if (s && n) return `${ident(s)}.${ident(n)}`;
  if (n) return ident(n);
  if (s) return ident(s);
  return '';
}

function normalizeKind(raw: unknown): DbPrincipalKind {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('group') || s === 'g') return 'group';
  if (s.includes('role') || s === 'r') return 'role';
  return 'user';
}

function normalizeObjectType(raw: unknown): DbPrivilegeObjectType {
  const s = String(raw ?? '').toUpperCase();
  if (s.includes('COLUMN') && !s.includes('OBJECT_OR_COLUMN')) return 'COLUMN';
  if (s.includes('SCHEMA')) return 'SCHEMA';
  if (s.includes('DATABASE')) return 'DATABASE';
  if (s.includes('ROLE')) return 'ROLE';
  if (s.includes('SYSTEM') || s.includes('SERVER')) return 'SYSTEM';
  if (s.includes('TABLE') || s.includes('OBJECT') || s.includes('VIEW') || s.includes('OBJECT_OR_COLUMN')) {
    return 'TABLE';
  }
  if (!s) return 'TABLE';
  return 'OTHER';
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return row[key];
    const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found) return row[found];
  }
  return undefined;
}

function asString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function asBool(v: unknown): boolean | null {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'bigint') return v !== 0n;
  const s = String(v).trim().toLowerCase();
  if (['1', 't', 'true', 'y', 'yes', 'g'].includes(s)) return true;
  if (['0', 'f', 'false', 'n', 'no'].includes(s)) return false;
  return null;
}

function splitList(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => stripQuotes(s.trim()))
    .filter(Boolean);
}

function stripQuotes(name: string): string {
  return name.replace(/^['"`\[]+/, '').replace(/['"`\]]+$/, '').replace(/'@'/g, '@');
}

function emptyToNull(s: string): string | null {
  return s ? s : null;
}

const PG_PRINCIPALS = `
SELECT r.rolname AS name,
       CASE WHEN r.rolcanlogin THEN 'user' ELSE 'role' END AS kind,
       r.rolcanlogin AS can_login,
       COALESCE((
         SELECT string_agg(g.rolname, ',' ORDER BY g.rolname)
         FROM pg_auth_members am
         JOIN pg_roles g ON g.oid = am.roleid
         WHERE am.member = r.oid
       ), '') AS member_of,
       COALESCE((
         SELECT string_agg(m.rolname, ',' ORDER BY m.rolname)
         FROM pg_auth_members am
         JOIN pg_roles m ON m.oid = am.member
         WHERE am.roleid = r.oid
       ), '') AS members
FROM pg_roles r
WHERE r.rolname NOT LIKE 'pg\\_%'
ORDER BY CASE WHEN r.rolcanlogin THEN 1 ELSE 0 END, r.rolname
`.trim();

const PG_PRIVILEGES = `
SELECT grantee,
       privilege_type AS privilege,
       'TABLE' AS object_type,
       table_schema AS object_schema,
       table_name AS object_name,
       CASE WHEN is_grantable = 'YES' THEN 1 ELSE 0 END AS grantable,
       grantor
FROM information_schema.role_table_grants
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
UNION ALL
SELECT grantee,
       privilege_type,
       'SCHEMA',
       object_schema,
       object_name,
       CASE WHEN is_grantable = 'YES' THEN 1 ELSE 0 END,
       grantor
FROM information_schema.usage_privileges
WHERE object_type = 'SCHEMA'
UNION ALL
SELECT m.rolname,
       g.rolname,
       'ROLE',
       NULL,
       g.rolname,
       CASE WHEN am.admin_option THEN 1 ELSE 0 END,
       NULL
FROM pg_auth_members am
JOIN pg_roles g ON g.oid = am.roleid
JOIN pg_roles m ON m.oid = am.member
WHERE g.rolname NOT LIKE 'pg\\_%'
`.trim();

const MYSQL_PRINCIPALS = `
SELECT CONCAT(u.User, '@', u.Host) AS name,
       'user' AS kind,
       1 AS can_login,
       COALESCE((
         SELECT GROUP_CONCAT(DISTINCT CONCAT(e.FROM_USER, '@', e.FROM_HOST) ORDER BY e.FROM_USER)
         FROM mysql.role_edges e
         WHERE e.TO_USER = u.User AND e.TO_HOST = u.Host
       ), '') AS member_of,
       COALESCE((
         SELECT GROUP_CONCAT(DISTINCT CONCAT(e.TO_USER, '@', e.TO_HOST) ORDER BY e.TO_USER)
         FROM mysql.role_edges e
         WHERE e.FROM_USER = u.User AND e.FROM_HOST = u.Host
       ), '') AS members
FROM mysql.user u
WHERE u.User <> ''
ORDER BY u.User, u.Host
`.trim();

const MARIADB_PRINCIPALS = `
SELECT CONCAT(u.User, '@', u.Host) AS name,
       'user' AS kind,
       1 AS can_login,
       COALESCE((
         SELECT GROUP_CONCAT(DISTINCT rm.Role ORDER BY rm.Role)
         FROM mysql.roles_mapping rm
         WHERE rm.User = u.User AND rm.Host = u.Host
       ), '') AS member_of,
       '' AS members
FROM mysql.user u
WHERE u.User <> ''
ORDER BY u.User, u.Host
`.trim();

const MYSQL_PRINCIPALS_FALLBACK = `
SELECT CURRENT_USER() AS name, 'user' AS kind, 1 AS can_login, '' AS member_of, '' AS members
`.trim();

const MYSQL_PRIVILEGES = `
SELECT GRANTEE AS grantee,
       PRIVILEGE_TYPE AS privilege,
       'TABLE' AS object_type,
       TABLE_SCHEMA AS object_schema,
       TABLE_NAME AS object_name,
       CASE WHEN IS_GRANTABLE = 'YES' THEN 1 ELSE 0 END AS grantable,
       NULL AS grantor
FROM information_schema.TABLE_PRIVILEGES
UNION ALL
SELECT GRANTEE,
       PRIVILEGE_TYPE,
       'SCHEMA',
       TABLE_SCHEMA,
       NULL,
       CASE WHEN IS_GRANTABLE = 'YES' THEN 1 ELSE 0 END,
       NULL
FROM information_schema.SCHEMA_PRIVILEGES
`.trim();

const MYSQL_PRIVILEGES_SCHEMA = `
SELECT GRANTEE AS grantee,
       PRIVILEGE_TYPE AS privilege,
       'TABLE' AS object_type,
       TABLE_SCHEMA AS object_schema,
       TABLE_NAME AS object_name,
       CASE WHEN IS_GRANTABLE = 'YES' THEN 1 ELSE 0 END AS grantable,
       NULL AS grantor
FROM information_schema.TABLE_PRIVILEGES
WHERE TABLE_SCHEMA = ?
UNION ALL
SELECT GRANTEE,
       PRIVILEGE_TYPE,
       'SCHEMA',
       TABLE_SCHEMA,
       NULL,
       CASE WHEN IS_GRANTABLE = 'YES' THEN 1 ELSE 0 END,
       NULL
FROM information_schema.SCHEMA_PRIVILEGES
WHERE TABLE_SCHEMA = ?
`.trim();

const MSSQL_PRINCIPALS = `
SELECT dp.name AS name,
       CASE
         WHEN dp.type IN ('R', 'A') THEN 'role'
         WHEN dp.type = 'G' THEN 'group'
         ELSE 'user'
       END AS kind,
       CASE WHEN dp.type IN ('S', 'U', 'E', 'X') THEN 1 ELSE 0 END AS can_login,
       ISNULL(STUFF((
         SELECT ',' + r.name
         FROM sys.database_role_members rm
         JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
         WHERE rm.member_principal_id = dp.principal_id
         FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 1, ''), '') AS member_of,
       ISNULL(STUFF((
         SELECT ',' + m.name
         FROM sys.database_role_members rm
         JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
         WHERE rm.role_principal_id = dp.principal_id
         FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 1, ''), '') AS members
FROM sys.database_principals dp
WHERE dp.name IS NOT NULL
  AND dp.type IN ('S', 'U', 'G', 'R', 'A', 'E', 'X')
  AND dp.name NOT IN ('sys', 'INFORMATION_SCHEMA')
ORDER BY CASE WHEN dp.type IN ('R', 'A', 'G') THEN 0 ELSE 1 END, dp.name
`.trim();

const MSSQL_PRIVILEGES = `
SELECT dp.name AS grantee,
       p.permission_name AS privilege,
       p.class_desc AS object_type,
       OBJECT_SCHEMA_NAME(p.major_id) AS object_schema,
       OBJECT_NAME(p.major_id) AS object_name,
       CASE WHEN p.state = 'W' THEN 1 ELSE 0 END AS grantable,
       gp.name AS grantor,
       p.state_desc AS state
FROM sys.database_permissions p
JOIN sys.database_principals dp ON dp.principal_id = p.grantee_principal_id
LEFT JOIN sys.database_principals gp ON gp.principal_id = p.grantor_principal_id
WHERE dp.name IS NOT NULL
UNION ALL
SELECT m.name,
       r.name,
       'ROLE',
       NULL,
       r.name,
       0,
       NULL,
       'GRANT'
FROM sys.database_role_members rm
JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
`.trim();

const ORACLE_PRINCIPALS_DBA = `
SELECT u.USERNAME AS name, 'user' AS kind, 1 AS can_login,
       NVL((SELECT LISTAGG(rp.GRANTED_ROLE, ',') WITHIN GROUP (ORDER BY rp.GRANTED_ROLE)
            FROM DBA_ROLE_PRIVS rp WHERE rp.GRANTEE = u.USERNAME), '') AS member_of,
       '' AS members
FROM DBA_USERS u
UNION ALL
SELECT r.ROLE, 'role', 0,
       '',
       NVL((SELECT LISTAGG(rp.GRANTEE, ',') WITHIN GROUP (ORDER BY rp.GRANTEE)
            FROM DBA_ROLE_PRIVS rp WHERE rp.GRANTED_ROLE = r.ROLE), '')
FROM DBA_ROLES r
`.trim();

const ORACLE_PRINCIPALS_ALL = `
SELECT USERNAME AS name, 'user' AS kind, 1 AS can_login, '' AS member_of, '' AS members
FROM ALL_USERS
`.trim();

const ORACLE_PRIVILEGES_DBA = `
SELECT GRANTEE, PRIVILEGE, 'TABLE' AS object_type, OWNER AS object_schema, TABLE_NAME AS object_name,
       CASE WHEN GRANTABLE = 'YES' THEN 1 ELSE 0 END AS grantable, GRANTOR
FROM DBA_TAB_PRIVS
UNION ALL
SELECT GRANTEE, GRANTED_ROLE, 'ROLE', NULL, GRANTED_ROLE,
       CASE WHEN ADMIN_OPTION = 'YES' THEN 1 ELSE 0 END, NULL
FROM DBA_ROLE_PRIVS
UNION ALL
SELECT GRANTEE, PRIVILEGE, 'SYSTEM', NULL, NULL,
       CASE WHEN ADMIN_OPTION = 'YES' THEN 1 ELSE 0 END, NULL
FROM DBA_SYS_PRIVS
`.trim();

const ORACLE_PRIVILEGES_ALL = `
SELECT GRANTEE, PRIVILEGE, 'TABLE' AS object_type, OWNER AS object_schema, TABLE_NAME AS object_name,
       CASE WHEN GRANTABLE = 'YES' THEN 1 ELSE 0 END AS grantable, GRANTOR
FROM ALL_TAB_PRIVS
`.trim();

const DB2_PRINCIPALS = `
SELECT R.ROLENAME AS name,
       'role' AS kind,
       0 AS can_login,
       '' AS member_of,
       COALESCE((
         SELECT LISTAGG(TRIM(A.GRANTEE), ',') WITHIN GROUP (ORDER BY A.GRANTEE)
         FROM SYSCAT.ROLEAUTH A
         WHERE A.ROLENAME = R.ROLENAME
       ), '') AS members
FROM SYSCAT.ROLES R
WHERE R.ROLENAME NOT LIKE 'SYS%'
ORDER BY R.ROLENAME
`.trim();

const DB2_PRIVILEGES = `
SELECT TRIM(GRANTEE) AS grantee, 'SELECT' AS privilege, 'TABLE' AS object_type,
       TRIM(TABSCHEMA) AS object_schema, TRIM(TABNAME) AS object_name,
       CASE WHEN SELECTAUTH = 'G' THEN 1 ELSE 0 END AS grantable, TRIM(GRANTOR) AS grantor
FROM SYSCAT.TABAUTH WHERE SELECTAUTH IN ('Y', 'G')
UNION ALL
SELECT TRIM(GRANTEE), 'INSERT', 'TABLE', TRIM(TABSCHEMA), TRIM(TABNAME),
       CASE WHEN INSERTAUTH = 'G' THEN 1 ELSE 0 END, TRIM(GRANTOR)
FROM SYSCAT.TABAUTH WHERE INSERTAUTH IN ('Y', 'G')
UNION ALL
SELECT TRIM(GRANTEE), 'UPDATE', 'TABLE', TRIM(TABSCHEMA), TRIM(TABNAME),
       CASE WHEN UPDATEAUTH = 'G' THEN 1 ELSE 0 END, TRIM(GRANTOR)
FROM SYSCAT.TABAUTH WHERE UPDATEAUTH IN ('Y', 'G')
UNION ALL
SELECT TRIM(GRANTEE), 'DELETE', 'TABLE', TRIM(TABSCHEMA), TRIM(TABNAME),
       CASE WHEN DELETEAUTH = 'G' THEN 1 ELSE 0 END, TRIM(GRANTOR)
FROM SYSCAT.TABAUTH WHERE DELETEAUTH IN ('Y', 'G')
UNION ALL
SELECT TRIM(GRANTEE), TRIM(ROLENAME), 'ROLE', NULL, TRIM(ROLENAME), 0, NULL
FROM SYSCAT.ROLEAUTH
WHERE ROLENAME NOT LIKE 'SYS%'
`.trim();

const CLICKHOUSE_PRINCIPALS = `
SELECT name, 'user' AS kind, 1 AS can_login, '' AS member_of, '' AS members FROM system.users
UNION ALL
SELECT name, 'role', 0, '', '' FROM system.roles
`.trim();

const CLICKHOUSE_PRIVILEGES = `
SELECT if(user_name != '', user_name, role_name) AS grantee,
       access_type AS privilege,
       if(table != '', 'TABLE', if(database != '', 'SCHEMA', 'SYSTEM')) AS object_type,
       nullIf(database, '') AS object_schema,
       nullIf(table, '') AS object_name,
       grant_option AS grantable,
       NULL AS grantor
FROM system.grants
`.trim();

const GENERIC_PRINCIPALS = `
SELECT GRANTEE AS name, 'user' AS kind, 1 AS can_login, '' AS member_of, '' AS members
FROM information_schema.TABLE_PRIVILEGES
GROUP BY GRANTEE
`.trim();

const GENERIC_PRIVILEGES = `
SELECT GRANTEE AS grantee,
       PRIVILEGE_TYPE AS privilege,
       'TABLE' AS object_type,
       TABLE_SCHEMA AS object_schema,
       TABLE_NAME AS object_name,
       CASE WHEN IS_GRANTABLE = 'YES' THEN 1 ELSE 0 END AS grantable,
       NULL AS grantor
FROM information_schema.TABLE_PRIVILEGES
`.trim();
