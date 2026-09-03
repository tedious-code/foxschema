/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Db2 GRANT/REVOKE. Table privileges are per object; schema-wide table grants
 * are a comment, not a guess.
 */
import { highestRisk } from '../../modules/access/intent.js';
import {
  describePrivs,
  executePermissions,
  objectPrivileges,
  routinesByKind,
  qualifier,
  scopeSchema,
  tablePermissions,
  tablePrivileges,
} from '../../modules/access/access-sql-helpers.js';
import type { AccessSqlDialect, EmitCtx } from '../../modules/access/access-sql.types.js';

function emitDb2(ctx: EmitCtx): void {
  const { request, grantee, ident, verb, dir, option, add } = ctx;
  const { scope, permissions } = request;
  const privs = tablePrivileges(permissions);
  const tablePerms = tablePermissions(permissions);
  const schema = scopeSchema(scope);
  // `grantee` already carries the USER/ROLE prefix from formatDbGrantee —
  // repeating it here produced `TO USER USER "REPORT_USER"`.

  if (permissions.includes('connect') && scope.type === 'database') {
    // Db2 database authorities cannot be passed on, so no WITH GRANT OPTION.
    add(
      `${verb} CONNECT ON DATABASE ${dir} ${grantee};`,
      `Lets ${request.principal.name} connect to the database.`,
      'low',
      ['connect']
    );
  }
  if (permissions.includes('create-object') && scope.type !== 'tables') {
    if (schema) {
      add(
        `${verb} CREATEIN ON SCHEMA ${ident(schema)} ${dir} ${grantee}${option};`,
        `Lets ${request.principal.name} create objects in ${schema}.`,
        'administrative',
        ['create-object']
      );
    } else {
      // At database scope there is no schema to name; CREATETAB is the database
      // authority that covers it. Falling back to the scope keyword emitted
      // `ON SCHEMA "database"`, a schema nobody has.
      add(
        `${verb} CREATETAB ON DATABASE ${dir} ${grantee};`,
        `Lets ${request.principal.name} create tables in the database. Db2 calls this the CREATETAB database authority.`,
        'administrative',
        ['create-object']
      );
    }
  }
  // Ahead of the empty-privilege return: an EXECUTE-only routine request has no
  // table privileges and would otherwise fall through to the "repeat per table"
  // comment, which says nothing about routines.
  if (scope.type === 'routines') {
    const execPerms = executePermissions(permissions);
    if (execPerms.length === 0) return;
    const { procedures, functions } = routinesByKind(scope);
    for (const [keyword, names] of [
      ['PROCEDURE', procedures],
      ['FUNCTION', functions],
    ] as const) {
      for (const name of names) {
        add(
          `${verb} EXECUTE ON ${keyword} ${ident(scope.schema)}.${ident(name)} ${dir} ${grantee}${option};`,
          `Lets ${request.principal.name} run ${keyword.toLowerCase()} ${scope.schema}.${name}.`,
          'elevated',
          execPerms
        );
      }
    }
    return;
  }

  if (scope.type === 'tables') {
    const extra = objectPrivileges(permissions, ctx.dialect, 'table');
    for (const pv of extra.privs) if (!privs.includes(pv)) privs.push(pv);
    tablePerms.push(...extra.covers);
  }
  if (privs.length === 0) return;

  if (scope.type === 'tables') {
    for (const table of scope.tables) {
      add(
        `${verb} ${privs.join(', ')} ON TABLE ${ident(scope.schema)}.${ident(table)} ${dir} ${grantee}${option};`,
        `${describePrivs(privs)} on ${scope.schema}.${table}.`,
        highestRisk(permissions),
        tablePerms
      );
    }
    return;
  }
  // Db2 has no "all tables in schema" grant — SELECTIN-style schema privileges
  // exist only for a few verbs, so name the limitation instead of guessing.
  add(
    `-- Db2 grants table privileges per object. Repeat for each table:\n-- ${verb} ${privs.join(', ')} ON TABLE ${qualifier(ident, schema)}.<table> ${dir} ${grantee};`,
    'Db2 has no schema-wide table grant. Select individual tables to generate runnable statements.',
    highestRisk(permissions)
    // No `covers` — see the note in oracle.access-sql.ts. A commented-out
    // template cannot grant anything, so it must not silence the warning.
  );
}

export const db2AccessSql: AccessSqlDialect = {
  id: 'db2',
  emit: emitDb2,
};
