/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * DDL for database accounts: create, alter and drop a user or a role.
 *
 * This generates SQL and nothing else. Fox Schema does not create accounts —
 * the statements are shown to a DBA to review and run. That is why there is no
 * matching execute path and no capability here for applying anything.
 *
 * ## Passwords are never handled
 *
 * A password belongs in the DBA's hands, not in a browser tab, a React state
 * tree or a history record. Statements that need one are emitted with the
 * {@link PASSWORD_PLACEHOLDER} in its place and a warning to substitute it
 * before running. Nothing here accepts a password argument, so there is no path
 * by which one could be stored or logged.
 *
 * ## A user is not a role
 *
 * The two are separate on every engine that has both, and conflating them is
 * the usual source of confusion: a role holds privileges, a user logs in.
 * {@link PrincipalType} makes the caller choose, and the emitters differ
 * accordingly — most visibly on SQL Server, where a login and a database user
 * are two objects and creating an account means creating both.
 *
 * ## Per-dialect modules
 *
 * Emitters live next to migration dialects as
 * `packages/sql/src/providers/<name>/<name>.user-sql.ts` and are registered in
 * {@link resolveUserSql}. This stays in `@foxschema/sql` (pure, browser-safe) —
 * not `@foxschema/db`, which is Node drivers only.
 */
export {
  PASSWORD_PLACEHOLDER,
  type PrincipalType,
  type UserAction,
  type UserAlteration,
  type UserRequest,
  type GeneratedUserSql,
  type UserManagementSupport,
  type UserSqlDialect,
} from './user-sql.types.js';

export {
  buildDb2OsUserInstructions,
  DB2_DOCKER_CONTAINER,
  DB2_DOCKER_DATABASE,
} from '../../providers/db2/db2.user-sql.js';

import type { GeneratedUserSql, UserManagementSupport, UserRequest } from './user-sql.types.js';
import { resolveUserSql } from './user-sql.registry.js';

export function userManagementSupport(dialect: string): UserManagementSupport {
  return { ...resolveUserSql(dialect).support };
}

/**
 * Build the DDL for one account change.
 *
 * Returns `{ error }` rather than approximate SQL when the engine cannot
 * express the request — running a statement that is nearly right against an
 * account is worse than being told it is not possible.
 */
export function buildUserSql(
  request: UserRequest,
  dialect: string
): GeneratedUserSql | { error: string } {
  const name = request.name.trim();
  if (!name) return { error: 'Enter a name for the account.' };

  const impl = resolveUserSql(dialect);
  const support = impl.support;
  if (!support.supported) {
    return { error: support.reason ?? 'Not supported on this engine.' };
  }

  const isUser = request.principalType === 'user';
  if (isUser && !support.canCreateUser && request.action === 'create') {
    return { error: support.reason ?? 'This engine cannot create users in SQL.' };
  }

  return impl.build({ ...request, name }, dialect);
}
