/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQL Server / Azure SQL GRANT/REVOKE/DENY (`OBJECT::` / `SCHEMA::`).
 */
import { highestRisk } from '../../modules/access/intent.js';
import {
  describePrivs,
  executePermissions,
  tablePermissions,
  tablePrivileges,
} from '../../modules/access/access-sql-helpers.js';
import type { AccessSqlDialect, EmitCtx } from '../../modules/access/access-sql.types.js';

function emitSqlServer(ctx: EmitCtx): void {
  const { request, grantee, ident, verb, dir, option, add } = ctx;
  const { scope, permissions } = request;
  const privs = tablePrivileges(permissions);
  const covers = [...tablePermissions(permissions)];
  const execPerms = executePermissions(permissions);
  if (permissions.includes('alter-object')) {
    privs.push('ALTER');
    covers.push('alter-object');
  }
  if (execPerms.length > 0) {
    privs.push('EXECUTE');
    covers.push(...execPerms);
  }
  // DROP is not a SQL Server permission — ALTER on the container carries it —
  // so `drop-object` stays uncovered and buildAccessSql says so.

  if (permissions.includes('connect') && scope.type === 'database') {
    add(
      `${verb} CONNECT ${dir} ${grantee}${option};`,
      `Lets ${request.principal.name} connect to the current database.`,
      'low',
      ['connect']
    );
  }
  if (permissions.includes('create-object')) {
    add(
      `${verb} CREATE TABLE ${dir} ${grantee}${option};`,
      `Lets ${request.principal.name} create tables in this database.`,
      'administrative',
      ['create-object']
    );
  }
  if (privs.length === 0) return;

  if (scope.type === 'columns') {
    const colList = scope.columns.map((c) => ident(c)).join(', ');
    add(
      `${verb} ${privs.join(', ')} ON OBJECT::${ident(scope.schema)}.${ident(scope.table)} (${colList}) ${dir} ${grantee}${option};`,
      `${describePrivs(privs)} on ${scope.columns.length} column(s) of ${scope.schema}.${scope.table}.`,
      highestRisk(permissions),
      covers
    );
    return;
  }

  if (scope.type === 'tables') {
    for (const table of scope.tables) {
      add(
        `${verb} ${privs.join(', ')} ON OBJECT::${ident(scope.schema)}.${ident(table)} ${dir} ${grantee}${option};`,
        `${describePrivs(privs)} on ${scope.schema}.${table}.`,
        highestRisk(permissions),
        covers
      );
    }
    return;
  }
  if (scope.type === 'schema') {
    add(
      `${verb} ${privs.join(', ')} ON SCHEMA::${ident(scope.schema)} ${dir} ${grantee}${option};`,
      `${describePrivs(privs)} on everything in ${scope.schema}, including objects added later — SQL Server schema grants cover future objects automatically.`,
      highestRisk(permissions),
      covers
    );
    return;
  }
  add(
    `${verb} ${privs.join(', ')} ${dir} ${grantee}${option};`,
    `${describePrivs(privs)} across the whole database.`,
    highestRisk(permissions),
    covers
  );
}

export const sqlServerAccessSql: AccessSqlDialect = {
  id: 'sqlserver',
  emit: emitSqlServer,
};
