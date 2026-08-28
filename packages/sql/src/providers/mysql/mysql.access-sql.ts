/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * MySQL / MariaDB GRANT/REVOKE. Database and schema are one concept (`db.*`).
 */
import { highestRisk } from '../../modules/access/intent.js';
import {
  describePrivs,
  executePermissions,
  tablePermissions,
  tablePrivileges,
} from '../../modules/access/access-sql-helpers.js';
import type { AccessSqlDialect, EmitCtx } from '../../modules/access/access-sql.types.js';

function emitMysql(ctx: EmitCtx): void {
  const { request, grantee, ident, verb, dir, option, add } = ctx;
  const { scope, permissions } = request;
  const privs = tablePrivileges(permissions);
  const covers = [...tablePermissions(permissions)];
  const execPerms = executePermissions(permissions);
  if (permissions.includes('create-object')) {
    privs.push('CREATE');
    covers.push('create-object');
  }
  if (permissions.includes('alter-object')) {
    privs.push('ALTER');
    covers.push('alter-object');
  }
  if (permissions.includes('drop-object')) {
    privs.push('DROP');
    covers.push('drop-object');
  }
  if (execPerms.length > 0) {
    privs.push('EXECUTE');
    covers.push(...execPerms);
  }
  if (privs.length === 0) return;

  if (scope.type === 'columns') {
    const colList = scope.columns.map((c) => ident(c)).join(', ');
    add(
      `${verb} ${privs.join(', ')} (${colList}) ON ${ident(scope.schema)}.${ident(scope.table)} ${dir} ${grantee}${option};`,
      `${describePrivs(privs)} on ${scope.columns.length} column(s) of ${scope.schema}.${scope.table}.`,
      highestRisk(permissions),
      covers
    );
    return;
  }

  if (scope.type === 'tables') {
    for (const table of scope.tables) {
      add(
        `${verb} ${privs.join(', ')} ON ${ident(scope.schema)}.${ident(table)} ${dir} ${grantee}${option};`,
        `${describePrivs(privs)} on ${scope.schema}.${table}.`,
        highestRisk(permissions),
        covers
      );
    }
    return;
  }
  // MySQL's database and schema are one concept, so both scopes render as db.*
  const db = scope.type === 'database' ? scope.database : scope.schema;
  add(
    `${verb} ${privs.join(', ')} ON ${ident(db)}.* ${dir} ${grantee}${option};`,
    `${describePrivs(privs)} on every table in ${db}, including tables created later.`,
    highestRisk(permissions),
    covers
  );
}

export const mysqlAccessSql: AccessSqlDialect = {
  id: 'mysql',
  emit: emitMysql,
};
