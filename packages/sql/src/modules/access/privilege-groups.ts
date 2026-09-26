/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reading a privilege list the way a DBA does: by object, and with "all of
 * them" said once.
 *
 * Engines store `GRANT ALL` expanded — MySQL keeps `ALL PRIVILEGES ON *.*` as
 * some thirty rows, Postgres keeps `ALL ON TABLE` as seven — so a list of rows
 * buries the one fact that matters, that this account may do anything. These
 * helpers group rows per object, say when a group is the engine's whole set,
 * and find accounts that are allowed everything, directly or through a role.
 *
 * Pure: it takes rows the probes already fetched.
 */
import { accessFamily } from './intent.js';
import type { DbPrincipal, DbPrivilege, DbPrivilegeObjectType } from './db-access.js';
import { resolveRoleChain } from './effective.js';

/**
 * The privileges `GRANT ALL` expands to, per engine family and object level.
 *
 * A group holding every name here is reported as ALL. The MySQL global set is
 * the part MySQL 8, MariaDB 11 and TiDB share: each adds its own dynamic
 * privileges on top (MariaDB's BINLOG ADMIN, TiDB's CONFIG), so demanding the
 * full list of any one would miss the other two.
 */
const ALL_SETS: Record<string, Partial<Record<DbPrivilegeObjectType, readonly string[]>>> = {
  mysql: {
    GLOBAL: [
      'ALTER', 'ALTER ROUTINE', 'CREATE', 'CREATE ROUTINE', 'CREATE TEMPORARY TABLES',
      'CREATE USER', 'CREATE VIEW', 'DELETE', 'DROP', 'EVENT', 'EXECUTE', 'FILE', 'INDEX',
      'INSERT', 'LOCK TABLES', 'PROCESS', 'REFERENCES', 'RELOAD', 'REPLICATION SLAVE',
      'SELECT', 'SHOW VIEW', 'SHUTDOWN', 'TRIGGER', 'UPDATE',
    ],
    SCHEMA: [
      'ALTER', 'ALTER ROUTINE', 'CREATE', 'CREATE ROUTINE', 'CREATE TEMPORARY TABLES',
      'CREATE VIEW', 'DELETE', 'DROP', 'EVENT', 'EXECUTE', 'INDEX', 'INSERT', 'LOCK TABLES',
      'REFERENCES', 'SELECT', 'SHOW VIEW', 'TRIGGER', 'UPDATE',
    ],
    TABLE: [
      'ALTER', 'CREATE', 'CREATE VIEW', 'DELETE', 'DROP', 'INDEX', 'INSERT', 'REFERENCES',
      'SELECT', 'SHOW VIEW', 'TRIGGER', 'UPDATE',
    ],
  },
  postgres: {
    // Postgres 17 adds MAINTAIN; a superset still counts.
    TABLE: ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
    SCHEMA: ['CREATE', 'USAGE'],
    DATABASE: ['CONNECT', 'CREATE', 'TEMPORARY'],
  },
};

/** Names that mean "everything at this level" on their own. */
const ALL_NAMES = new Set(['ALL', 'ALL PRIVILEGES', 'CONTROL']);

function setFamily(dialect: string): string {
  const fam = accessFamily(dialect);
  return fam === 'mariadb' ? 'mysql' : fam;
}

/** Whether these privilege names are the engine's whole set for this kind of object. */
export function isAllPrivilegeSet(
  dialect: string,
  objectType: DbPrivilegeObjectType,
  names: readonly string[]
): boolean {
  const held = new Set(names.map((n) => n.trim().toUpperCase()));
  for (const n of held) if (ALL_NAMES.has(n)) return true;
  const set = ALL_SETS[setFamily(dialect)]?.[objectType];
  if (!set || held.size === 0) return false;
  return set.every((p) => held.has(p));
}

export interface PrivilegeGroup {
  key: string;
  objectType: DbPrivilegeObjectType;
  objectSchema: string | null;
  objectName: string | null;
  state: DbPrivilege['state'];
  privileges: DbPrivilege[];
  /** The group is the engine's whole set for this object: show it as ALL. */
  all: boolean;
}

/**
 * One group per object (and per GRANT/DENY, which must never be merged), in
 * first-seen order. Role memberships are not object privileges and are left
 * out.
 */
export function groupPrivileges(
  privileges: readonly DbPrivilege[],
  dialect: string
): PrivilegeGroup[] {
  const groups = new Map<string, PrivilegeGroup>();
  for (const p of privileges) {
    if (p.objectType === 'ROLE') continue;
    const key = [p.objectType, p.objectSchema ?? '', p.objectName ?? '', p.state ?? ''].join('\u0000');
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        objectType: p.objectType,
        objectSchema: p.objectSchema,
        objectName: p.objectName,
        state: p.state,
        privileges: [],
        all: false,
      };
      groups.set(key, group);
    }
    group.privileges.push(p);
  }
  for (const group of groups.values()) {
    group.all =
      group.state !== 'deny' &&
      isAllPrivilegeSet(
        dialect,
        group.objectType,
        group.privileges.map((p) => p.privilege)
      );
  }
  return [...groups.values()];
}

/** Where a privilege row points, in words: `*.*` rather than "GLOBAL". */
export function privilegeTargetLabel(p: {
  objectType: DbPrivilegeObjectType;
  objectSchema: string | null;
  objectName: string | null;
}): string {
  if (p.objectType === 'GLOBAL') return 'every database (*.*)';
  const named = [p.objectSchema, p.objectName].filter(Boolean).join('.');
  if (p.objectType === 'SCHEMA' && named) return `${named}.* (schema)`;
  if (p.objectType === 'DATABASE') return named ? `database ${named}` : 'this database';
  return named || p.objectType;
}

export type AllowAllKind = 'superuser' | 'all-on-server' | 'all-on-database';

export interface AllowAll {
  kind: AllowAllKind;
  /** The principal that holds it — the account itself, or a role it is in. */
  holder: string;
  /** Role hops from the account to the holder; empty when held directly. */
  via: string[];
}

function key(name: string): string {
  return (name || '').trim().toLowerCase();
}

function directAllowAll(
  holder: DbPrincipal | undefined,
  holderName: string,
  privileges: readonly DbPrivilege[],
  dialect: string
): AllowAllKind | null {
  if (holder?.superuser === true) return 'superuser';
  const own = privileges.filter((p) => key(p.grantee) === key(holderName));
  for (const group of groupPrivileges(own, dialect)) {
    if (!group.all) continue;
    if (group.objectType === 'GLOBAL') return 'all-on-server';
    // SQL Server CONTROL on the database (db_owner) is everything in it.
    if (group.objectType === 'DATABASE' && accessFamily(dialect) === 'sqlserver') {
      return 'all-on-database';
    }
  }
  return null;
}

/**
 * Whether this account may do anything, and through whom.
 *
 * "Anything" is deliberately narrow: a superuser, every privilege on the whole
 * server (`ON *.*`), or control of the whole database. Postgres `ALL ON
 * DATABASE` is not it — that is CONNECT, CREATE and TEMPORARY, and reads no
 * table. Nearest holder wins, so a direct grant is reported before a role's.
 */
export function findAllowAll(opts: {
  principal: string;
  principals: readonly DbPrincipal[];
  privileges: readonly DbPrivilege[];
  dialect: string;
}): AllowAll | null {
  const byName = new Map(opts.principals.map((p) => [key(p.name), p]));
  const direct = directAllowAll(byName.get(key(opts.principal)), opts.principal, opts.privileges, opts.dialect);
  if (direct) return { kind: direct, holder: opts.principal, via: [] };
  const chains = [...resolveRoleChain(opts.principal, opts.principals).values()].sort(
    (a, b) => a.length - b.length
  );
  for (const chain of chains) {
    const role = chain[chain.length - 1]!;
    const kind = directAllowAll(byName.get(key(role)), role, opts.privileges, opts.dialect);
    if (kind) return { kind, holder: byName.get(key(role))?.name ?? role, via: chain };
  }
  return null;
}

/** One line for a badge's tooltip or a banner. */
export function describeAllowAll(allow: AllowAll): string {
  const what =
    allow.kind === 'superuser'
      ? 'Superuser: bypasses every permission check, so the grants listed do not limit it.'
      : allow.kind === 'all-on-server'
        ? 'Holds every privilege on the whole server (*.*).'
        : 'Controls the whole database.';
  if (allow.via.length === 0) return what;
  return `${what} Inherited through ${allow.via.join(' → ')}.`;
}

/** One way to grant "everything" on this engine, for the grant form to offer. */
export interface AllPrivilegeTarget {
  id: string;
  /** What the reader picks, in their terms. */
  label: string;
  /** What it really confers, and what it does not. */
  note: string;
  objectType: DbPrivilegeObjectType;
  objectSchema: string | null;
  objectName: string | null;
  /** The engine's own name for "everything" at this level. */
  privilege: string;
}

/**
 * The allow-all grants this engine has, widest first.
 *
 * Each engine spells "everything" differently and at different levels, and
 * some levels do not exist: Postgres has no server-wide grant — that is
 * superuser, an account attribute set with ALTER ROLE, not a GRANT — and
 * `ALL ON DATABASE` there reads no table. The notes say so, because the word
 * ALL promises more than several of these deliver.
 */
export function allPrivilegeTargets(
  dialect: string,
  ctx: { database?: string | null; schema?: string | null }
): AllPrivilegeTarget[] {
  const fam = accessFamily(dialect);
  const db = ctx.database?.trim() || null;
  const schema = ctx.schema?.trim() || null;
  const out: AllPrivilegeTarget[] = [];
  const target = (t: AllPrivilegeTarget) => out.push(t);

  if (fam === 'mysql' || fam === 'mariadb' || fam === 'clickhouse') {
    target({
      id: 'server',
      label: 'Whole server (*.*)',
      note: 'Every privilege on every database, including creating users and shutting the server down.',
      objectType: 'GLOBAL',
      objectSchema: null,
      objectName: null,
      privilege: 'ALL',
    });
    const name = schema || db;
    if (name) {
      target({
        id: 'database',
        label: `Database ${name} (${name}.*)`,
        note: `Every privilege on ${name} and every table in it, including tables created later.`,
        objectType: 'DATABASE',
        objectSchema: null,
        objectName: name,
        privilege: 'ALL',
      });
    }
    return out;
  }
  if (fam === 'postgres') {
    if (db) {
      target({
        id: 'database',
        label: `Database ${db}`,
        note: 'CONNECT, CREATE and TEMPORARY on the database. It reads no table: that is granted per schema or table. Server-wide access is superuser (ALTER ROLE … SUPERUSER), not a grant.',
        objectType: 'DATABASE',
        objectSchema: null,
        objectName: db,
        privilege: 'ALL',
      });
    }
    if (schema) {
      target({
        id: 'schema',
        label: `Schema ${schema}`,
        note: 'USAGE and CREATE on the schema. The tables in it are granted separately.',
        objectType: 'SCHEMA',
        objectSchema: null,
        objectName: schema,
        privilege: 'ALL',
      });
    }
    return out;
  }
  if (fam === 'sqlserver') {
    if (db) {
      target({
        id: 'database',
        label: `Database ${db} (CONTROL)`,
        note: 'CONTROL on the database: every permission in it, as db_owner has.',
        objectType: 'DATABASE',
        objectSchema: null,
        objectName: db,
        privilege: 'CONTROL',
      });
    }
    if (schema) {
      target({
        id: 'schema',
        label: `Schema ${schema} (CONTROL)`,
        note: `CONTROL on the schema: every permission on ${schema} and everything in it.`,
        objectType: 'SCHEMA',
        objectSchema: null,
        objectName: schema,
        privilege: 'CONTROL',
      });
    }
    return out;
  }
  if (fam === 'oracle') {
    target({
      id: 'system',
      label: 'Every system privilege (ALL PRIVILEGES)',
      note: 'Every system privilege, including SELECT ANY TABLE and DROP ANY TABLE on every schema.',
      objectType: 'SYSTEM',
      objectSchema: null,
      objectName: null,
      privilege: 'ALL PRIVILEGES',
    });
    return out;
  }
  if (fam === 'db2') {
    target({
      id: 'database',
      label: 'Database administrator (DBADM)',
      note: 'DBADM on this database: create and drop objects, and with DATAACCESS read and write every table.',
      objectType: 'DATABASE',
      objectSchema: null,
      objectName: null,
      privilege: 'DBADM',
    });
    return out;
  }
  return out;
}
