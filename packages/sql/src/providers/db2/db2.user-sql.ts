/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Db2 account DDL — roles only (users are OS/directory accounts).
 */
import type { UserSqlDialect } from '../../modules/access/user-sql.types.js';
import { createUserSqlEmitter } from '../../modules/access/user-sql-helpers.js';
import type { PermissionRisk } from '../../modules/access/intent.js';

const DB2_REASON =
  'Db2 authenticates against the operating system or a directory service, so there is ' +
  'no CREATE USER. Create the account on the server, then grant it privileges here.';

export const db2UserSql: UserSqlDialect = {
  id: 'db2',
  support: {
    supported: true,
    canCreateUser: false,
    canCreateRole: true,
    canDisable: false,
    canRename: false,
    canExpire: false,
    reason: DB2_REASON,
  },

  build(request, dialect) {
    const { name, isUser, noun, add, q, finish } = createUserSqlEmitter(request, dialect);
    const support = this.support;

    if (request.action === 'create') {
      if (isUser) {
        return { error: support.reason ?? 'This engine cannot create users in SQL.' };
      }
      add(
        `CREATE ROLE ${q(name)};`,
        `Creates the role ${name}. A role holds privileges; grant it to users afterwards.`
      );
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
      return finish();
    }

    const change = request.alteration ?? 'password';
    if (change === 'rename') {
      const next = request.newName?.trim();
      if (!next) return { error: 'Enter the new name.' };
      return {
        error: `${dialect} cannot rename an account. Create the new one and drop the old.`,
      };
    }
    if (change === 'password') {
      if (!isUser) return { error: 'A role has no password.' };
      return { error: `${dialect} cannot set a password in SQL.` };
    }
    if (change === 'expire') {
      if (!isUser) return { error: 'A role has no expiry date.' };
      return { error: `${dialect} cannot set account expiry in SQL.` };
    }
    return {
      error: `${dialect} cannot disable an account. Drop it, or revoke its privileges instead.`,
    };
  },
};
