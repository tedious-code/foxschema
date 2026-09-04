/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared helpers for per-dialect account DDL (`*.user-sql.ts`).
 */
import type { PermissionRisk } from './intent.js';
import type { GeneratedStatement, PermissionWarning } from './access-sql.types.js';
import { quoteSqlIdentifier } from '../sql-text/sql-template.js';
import {
  PASSWORD_PLACEHOLDER,
  type GeneratedUserSql,
  type UserManagementSupport,
  type UserRequest,
  type UserSqlDialect,
} from './user-sql.types.js';

export const UNSUPPORTED_USER_SQL: UserManagementSupport = {
  supported: false,
  canCreateUser: false,
  canCreateRole: false,
  canDisable: false,
  canRename: false,
  canExpire: false,
  reason: 'This engine has no database accounts to manage.',
};

/**
 * Why one engine's accounts are out of reach, in that engine's own terms.
 *
 * "This engine has no database accounts to manage" is true of SQLite and
 * DuckDB, where a file's owner is the access control. It is simply false of
 * Redis and MongoDB, which both have full account systems — verified against
 * Redis 7 and MongoDB 7: `ACL SETUSER` created a user whose key pattern and
 * command list were then enforced, and `db.createUser` with a `read` role
 * allowed a find and refused an insert. What is true is that neither is
 * reachable through SQL, which is all this module speaks.
 *
 * Telling a Redis user their database has no accounts misinforms them about
 * their own server; naming the command they actually want does not.
 */
const NO_ACCOUNTS_REASON: Record<string, string> = {
  redis:
    'Fox Schema does not manage Redis accounts. Redis has them — ACL SETUSER, ACL LIST — but they are not reachable through SQL, so use redis-cli.',
  mongodb:
    'Fox Schema does not manage MongoDB accounts. MongoDB has them — db.createUser, db.grantRolesToUser — but they are not reachable through SQL, so use mongosh.',
};

/** MySQL-family string literals treat `\` as an escape — double it before quotes. */
function mysqlQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** MySQL identifies an account by user and host together. */
export function mysqlAccount(name: string, host: string | undefined): string {
  return `${mysqlQuote(name)}@${mysqlQuote(host?.trim() || '%')}`;
}

/**
 * How a *role* is named, which is not how a user is named on every engine.
 *
 * MariaDB roles have no host part and reject one outright: `CREATE ROLE
 * 'r'@'%'` is ERROR 1064 there, while MySQL 8 and TiDB accept it and default
 * the host to `%`. Sharing one MySQL-family emitter is right for users and
 * wrong here, so the role reference is built separately.
 */
export function mysqlRoleRef(name: string, host: string | undefined, dialect: string): string {
  return dialect.toLowerCase() === 'mariadb' ? mysqlQuote(name) : mysqlAccount(name, host);
}

export function ident(name: string, dialect: string): string {
  return quoteSqlIdentifier(name, dialect);
}

export function finalizeGeneratedUserSql(
  statements: GeneratedStatement[],
  warnings: PermissionWarning[],
  emptyError: string
): GeneratedUserSql | { error: string } {
  if (statements.length === 0) {
    return { error: emptyError };
  }

  if (statements.some((s) => s.sql.includes(PASSWORD_PLACEHOLDER))) {
    warnings.push({
      level: 'danger',
      message:
        `Replace ${PASSWORD_PLACEHOLDER} with a real password before running this. Fox Schema ` +
        'never handles the password: it is not stored, sent anywhere, or kept in history.',
    });
  }

  return {
    statements,
    warnings,
    risk: statements.some((s) => s.risk === 'critical')
      ? 'critical'
      : statements.some((s) => s.risk === 'administrative')
        ? 'administrative'
        : 'elevated',
  };
}

/** Mutable emitter used by dialect modules while building one request. */
export function createUserSqlEmitter(request: UserRequest, dialect: string) {
  const name = request.name.trim();
  const isUser = request.principalType === 'user';
  const noun = isUser ? 'user' : 'role';
  const statements: GeneratedStatement[] = [];
  const warnings: PermissionWarning[] = [];

  const add = (sql: string, explanation: string, risk: PermissionRisk = 'elevated') =>
    statements.push({ sql, explanation, risk });

  const q = (v: string) => ident(v, dialect);

  const finish = () =>
    finalizeGeneratedUserSql(
      statements,
      warnings,
      `Nothing to do for this ${noun} on ${dialect}.`
    );

  return { name, isUser, noun, statements, warnings, add, q, finish };
}

/** Stub for engines with no SQL-reachable accounts. */
export function unsupportedUserSqlDialect(id: string): UserSqlDialect {
  const reason = NO_ACCOUNTS_REASON[id] ?? UNSUPPORTED_USER_SQL.reason!;
  return {
    id,
    support: { ...UNSUPPORTED_USER_SQL, reason },
    build() {
      return { error: reason };
    },
  };
}
