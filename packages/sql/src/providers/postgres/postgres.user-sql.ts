/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Postgres account DDL (CREATE/ALTER/DROP ROLE with LOGIN for users).
 */
import {
  PASSWORD_PLACEHOLDER,
  type UserRequest,
  type UserSqlDialect,
} from '../../modules/access/user-sql.types.js';
import { createUserSqlEmitter } from '../../modules/access/user-sql-helpers.js';
import type { PermissionRisk } from '../../modules/access/intent.js';

export const postgresUserSql: UserSqlDialect = {
  id: 'postgres',
  support: {
    supported: true,
    canCreateUser: true,
    canCreateRole: true,
    canDisable: true,
    canRename: true,
    canExpire: true,
  },

  build(request, dialect) {
    const { name, isUser, noun, warnings, add, q, finish } = createUserSqlEmitter(
      request,
      dialect
    );
    const support = this.support;

    if (request.action === 'create') {
      if (!isUser) {
        add(
          `CREATE ROLE ${q(name)};`,
          `Creates the role ${name}. A role holds privileges; grant it to users afterwards.`
        );
      } else {
        // LOGIN is what separates a user from a role — the two are one object type.
        add(
          `CREATE ROLE ${q(name)} WITH LOGIN PASSWORD '${PASSWORD_PLACEHOLDER}';`,
          `Creates ${name} and allows it to connect. In Postgres a user is a role with LOGIN.`
        );
      }
      return finish();
    }

    if (request.action === 'drop') {
      const risk: PermissionRisk = 'administrative';
      const keyword = isUser ? 'USER' : 'ROLE';
      add(
        `DROP ${keyword} ${q(name)};`,
        `Drops the ${noun} ${name}. Privileges granted to it are removed with it.`,
        risk
      );
      warnings.push({
        level: 'caution',
        message:
          `Postgres refuses to drop ${name} while it owns objects or holds privileges. ` +
          `Reassign or drop those first: REASSIGN OWNED BY ${q(name)} TO ..., then DROP OWNED BY ${q(name)}.`,
      });
      return finish();
    }

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
    // VALID UNTIL takes a string literal — quote-escape so a crafted
    // date cannot close the literal and append another statement.
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
