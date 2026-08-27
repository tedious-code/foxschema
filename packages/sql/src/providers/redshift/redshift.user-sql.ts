/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Redshift account DDL — GROUP instead of ROLE; CREATE USER … PASSWORD.
 */
import {
  PASSWORD_PLACEHOLDER,
  type UserRequest,
  type UserSqlDialect,
} from '../../modules/access/user-sql.types.js';
import { createUserSqlEmitter } from '../../modules/access/user-sql-helpers.js';
import type { PermissionRisk } from '../../modules/access/intent.js';

export const redshiftUserSql: UserSqlDialect = {
  id: 'redshift',
  support: {
    supported: true,
    canCreateUser: true,
    canCreateRole: true,
    canDisable: true,
    canRename: true,
    canExpire: true,
  },

  build(request, dialect) {
    const { name, isUser, noun, add, q, finish } = createUserSqlEmitter(request, dialect);
    const support = this.support;

    if (request.action === 'create') {
      if (!isUser) {
        add(`CREATE GROUP ${q(name)};`, `Creates the group ${name}, which holds privileges.`);
      } else {
        add(
          `CREATE USER ${q(name)} PASSWORD '${PASSWORD_PLACEHOLDER}';`,
          `Creates ${name}.`
        );
      }
      return finish();
    }

    if (request.action === 'drop') {
      const risk: PermissionRisk = 'administrative';
      if (!isUser) {
        add(`DROP GROUP ${q(name)};`, `Drops the group ${name}.`, risk);
      } else {
        add(
          `DROP USER ${q(name)};`,
          `Drops the ${noun} ${name}. Privileges granted to it are removed with it.`,
          risk
        );
      }
      return finish();
    }

    // Alter paths historically followed the Postgres ROLE shape (family was postgres).
    const failed = buildAlter(request, dialect, name, isUser, support, add, q);
    if (failed) return { error: failed };
    return finish();
  },
};

function buildAlter(
  request: UserRequest,
  dialect: string,
  name: string,
  isUser: boolean,
  support: UserSqlDialect['support'],
  add: (sql: string, explanation: string, risk?: PermissionRisk) => void,
  q: (v: string) => string
): string | undefined {
  const change = request.alteration ?? 'password';

  if (change === 'rename') {
    const next = request.newName?.trim();
    if (!next) return 'Enter the new name.';
    if (!support.canRename) {
      return `${dialect} cannot rename an account. Create the new one and drop the old.`;
    }
    const keyword = isUser ? 'USER' : 'ROLE';
    add(
      `ALTER ${keyword} ${q(name)} RENAME TO ${q(next)};`,
      `Renames ${name} to ${next}. Privileges follow the account.`
    );
    return undefined;
  }

  if (change === 'password') {
    if (!isUser) return 'A role has no password.';
    add(
      `ALTER ROLE ${q(name)} WITH PASSWORD '${PASSWORD_PLACEHOLDER}';`,
      `Sets a new password for ${name}.`
    );
    return undefined;
  }

  if (change === 'expire') {
    if (!isUser) return 'A role has no expiry date.';
    if (!support.canExpire) {
      return `${dialect} cannot set account expiry in SQL.`;
    }
    const until = request.validUntil?.trim() || 'infinity';
    const untilLiteral = until.replace(/'/g, "''");
    add(
      `ALTER ROLE ${q(name)} VALID UNTIL '${untilLiteral}';`,
      until === 'infinity'
        ? `Removes expiry for ${name}.`
        : `Refuses connections from ${name} after ${until}.`
    );
    return undefined;
  }

  if (!support.canDisable) {
    return `${dialect} cannot disable an account. Drop it, or revoke its privileges instead.`;
  }
  const disabling = change === 'disable';
  add(
    `ALTER ROLE ${q(name)} ${disabling ? 'NOLOGIN' : 'LOGIN'};`,
    disabling
      ? `Refuses new connections from ${name}. Existing sessions continue until they end.`
      : `Lets ${name} connect again.`
  );
  return undefined;
}
