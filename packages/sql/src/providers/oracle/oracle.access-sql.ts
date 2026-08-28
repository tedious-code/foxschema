/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Oracle GRANT/REVOKE. System privileges take WITH ADMIN OPTION; object
 * privileges take WITH GRANT OPTION. A schema is a user — no schema-wide
 * table grant.
 */
import { highestRisk } from '../../modules/access/intent.js';
import {
  describePrivs,
  qualifier,
  scopeSchema,
  tablePermissions,
  tablePrivileges,
} from '../../modules/access/access-sql-helpers.js';
import type { AccessSqlDialect, EmitCtx } from '../../modules/access/access-sql.types.js';

function emitOracle(ctx: EmitCtx): void {
  const { request, grantee, ident, verb, dir, option, add } = ctx;
  const { scope, permissions } = request;
  const privs = tablePrivileges(permissions);
  const tablePerms = tablePermissions(permissions);
  // Oracle system privileges take WITH ADMIN OPTION; WITH GRANT OPTION is only
  // valid on object privileges and raises ORA-00990 here.
  const adminOption = option ? ' WITH ADMIN OPTION' : '';

  if (permissions.includes('connect')) {
    add(
      `${verb} CREATE SESSION ${dir} ${grantee}${adminOption};`,
      `Lets ${request.principal.name} open a session. Oracle calls this CREATE SESSION rather than CONNECT.`,
      'low',
      ['connect']
    );
  }
  if (permissions.includes('create-object')) {
    add(
      `${verb} CREATE TABLE ${dir} ${grantee}${adminOption};`,
      `Lets ${request.principal.name} create tables in their own schema.`,
      'administrative',
      ['create-object']
    );
  }
  if (privs.length === 0) return;

  if (scope.type === 'tables') {
    for (const table of scope.tables) {
      add(
        `${verb} ${privs.join(', ')} ON ${ident(scope.schema)}.${ident(table)} ${dir} ${grantee}${option};`,
        `${describePrivs(privs)} on ${scope.schema}.${table}.`,
        highestRisk(permissions),
        tablePerms
      );
    }
    return;
  }
  add(
    `-- Oracle grants object privileges per object. Repeat for each table:\n-- ${verb} ${privs.join(', ')} ON ${qualifier(ident, scopeSchema(scope))}.<table> ${dir} ${grantee};`,
    'Oracle has no schema-wide table grant; a schema is a user. Select individual tables to generate runnable statements.',
    highestRisk(permissions),
    tablePerms
  );
}

export const oracleAccessSql: AccessSqlDialect = {
  id: 'oracle',
  emit: emitOracle,
};
