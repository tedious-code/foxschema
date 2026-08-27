/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared helpers for per-dialect account DDL (`*.user-sql.ts`).
 */
import type { PermissionRisk } from './intent.js';
import type { GeneratedStatement, PermissionWarning } from './access-sql.js';
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

/** MySQL identifies an account by user and host together. */
export function mysqlAccount(name: string, host: string | undefined): string {
  // MySQL-family string literals treat `\` as an escape — double it before quotes.
  const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  return `${quote(name)}@${quote(host?.trim() || '%')}`;
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
  return {
    id,
    support: UNSUPPORTED_USER_SQL,
    build() {
      return { error: UNSUPPORTED_USER_SQL.reason! };
    },
  };
}
