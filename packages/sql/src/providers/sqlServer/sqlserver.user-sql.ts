/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQL Server / Azure SQL account DDL — LOGIN (server) + USER (database).
 */
import {
  PASSWORD_PLACEHOLDER,
  type UserRequest,
  type UserSqlDialect,
} from '../../modules/access/user-sql.types.js';
import { createUserSqlEmitter } from '../../modules/access/user-sql-helpers.js';
import type { PermissionRisk } from '../../modules/access/intent.js';

export const sqlServerUserSql: UserSqlDialect = {
  id: 'sqlserver',
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
        // A login authenticates to the server; a user maps it into this
        // database. One without the other cannot connect and use data.
        add(
          `CREATE LOGIN ${q(name)} WITH PASSWORD = '${PASSWORD_PLACEHOLDER}';`,
          `Creates the server login ${name}. Run this against the master database.`
        );
        add(
          `CREATE USER ${q(name)} FOR LOGIN ${q(name)};`,
          `Maps the login into this database as ${name}. Run this against the database itself.`
        );
        warnings.push({
          level: 'info',
          message:
            'SQL Server needs both: the login belongs to the server (master) and the user to ' +
            'this database. Run them against the right database each.',
        });
      }
      return finish();
    }

    if (request.action === 'drop') {
      const risk: PermissionRisk = 'administrative';
      if (isUser) {
        // Catalog lists database users only. Login names often differ
        // (`CREATE USER app FOR LOGIN corp_app`), so auto-emitting
        // `DROP LOGIN [app]` can delete an unrelated server login.
        add(`DROP USER ${q(name)};`, `Removes ${name} from this database.`, risk);
        warnings.push({
          level: 'caution',
          message:
            `Only the database user is dropped. If a server login should go too, drop it ` +
            `explicitly against master after confirming its name (it may differ from ${name}).`,
        });
      } else {
        add(
          `DROP ROLE ${q(name)};`,
          `Drops the ${noun} ${name}. Privileges granted to it are removed with it.`,
          risk
        );
      }
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
    add(
      `ALTER USER ${q(name)} WITH NAME = ${q(next)};`,
      `Renames ${name} to ${next}. Privileges follow the account.`
    );
    return undefined;
  }

  if (change === 'password') {
    if (!isUser) return 'A role has no password.';
    // Password lives on the LOGIN. We only know the database user name from
    // the catalog — emit ALTER LOGIN only when the operator confirms the
    // login shares this name (Fox Schema create does; many existing users do not).
    add(
      `ALTER LOGIN ${q(name)} WITH PASSWORD = '${PASSWORD_PLACEHOLDER}';`,
      `Sets a new password for the login ${name}. Run against master only if that login name matches this database user.`
    );
    return undefined;
  }

  if (change === 'expire') {
    if (!isUser) return 'A role has no expiry date.';
    if (!support.canExpire) {
      return `${dialect} cannot set account expiry in SQL.`;
    }
    add(
      `ALTER LOGIN ${q(name)} WITH CHECK_EXPIRATION ON;`,
      `Requires login ${name} to change password when it expires. Run against master only if that login name matches this database user.`
    );
    return undefined;
  }

  if (!support.canDisable) {
    return `${dialect} cannot disable an account. Drop it, or revoke its privileges instead.`;
  }
  const disabling = change === 'disable';
  add(
    `ALTER LOGIN ${q(name)} ${disabling ? 'DISABLE' : 'ENABLE'};`,
    disabling
      ? `Refuses new connections from login ${name}. Run against master only if that login name matches this database user.`
      : `Lets login ${name} connect again. Run against master only if that login name matches this database user.`
  );
  return undefined;
}
