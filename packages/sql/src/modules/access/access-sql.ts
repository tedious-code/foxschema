/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns an intent-level PermissionRequest into the statements one engine
 * actually needs.
 *
 * The count is not one-to-one and that is the whole point: "read the reporting
 * schema, including future tables" is three statements on PostgreSQL (USAGE,
 * SELECT ON ALL TABLES, ALTER DEFAULT PRIVILEGES) and one on SQL Server. Every
 * statement carries its own explanation, because a reader who is about to run
 * unfamiliar SQL against production deserves to know what each line does.
 *
 * Nothing here executes anything. FoxSchema generates and explains; the
 * database stays the source of truth.
 */

import { quoteSqlIdentifier } from '../sql-text/sql-template.js';
import { formatDbGrantee } from './db-access.js';
import {
  accessCapabilities,
  accessFamily,
  describePermission,
  highestRisk,
  type AccessPermission,
  type AccessScope,
  type PermissionRequest,
  type PermissionRisk,
} from './intent.js';

export interface GeneratedStatement {
  sql: string;
  /** What this one line does, in the reader's terms. */
  explanation: string;
  risk: PermissionRisk;
}

export type AccessWarningLevel = 'info' | 'caution' | 'danger';

export interface PermissionWarning {
  level: AccessWarningLevel;
  message: string;
}

export interface GeneratedPermissionSql {
  statements: GeneratedStatement[];
  warnings: PermissionWarning[];
  /** Worst risk across the statements, for a summary badge. */
  risk: PermissionRisk;
}

/** Privileges each intent maps to on table-shaped objects. */
const TABLE_PRIVILEGE: Partial<Record<AccessPermission, string>> = {
  read: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
};

function tablePrivileges(permissions: readonly AccessPermission[]): string[] {
  return permissions.map((p) => TABLE_PRIVILEGE[p]).filter((p): p is string => !!p);
}

/** The requested permissions those privileges came from, for coverage tracking. */
function tablePermissions(permissions: readonly AccessPermission[]): AccessPermission[] {
  return permissions.filter((p) => !!TABLE_PRIVILEGE[p]);
}

function executePermissions(permissions: readonly AccessPermission[]): AccessPermission[] {
  return permissions.filter((p) => p === 'execute-function' || p === 'execute-procedure');
}

function ownershipPermissions(permissions: readonly AccessPermission[]): AccessPermission[] {
  return permissions.filter((p) => p === 'alter-object' || p === 'drop-object');
}

function scopeSchema(scope: AccessScope): string {
  return scope.type === 'database' ? '' : scope.schema;
}

/**
 * A schema for a copy-and-edit hint. At database scope there is no schema to
 * name, and quoting the empty string gave `ON "".<table>` — a placeholder the
 * reader can fill in beats an identifier that only looks real.
 */
function qualifier(ident: (n: string) => string, schema: string): string {
  return schema ? ident(schema) : '<schema>';
}

/**
 * Families with a dedicated emitter. Anything else falls back to the PostgreSQL
 * shape, which `warnFor` says out loud rather than passing off as authoritative.
 */
const KNOWN_FAMILIES = new Set(['postgres', 'mysql', 'mariadb', 'sqlserver', 'db2', 'oracle']);

/**
 * Reject rather than approximate.
 *
 * A builder that quietly drops the part it cannot express leaves the reader
 * believing they granted something they did not — the worst possible failure
 * for a permissions tool.
 */
function validate(request: PermissionRequest, dialect: string): string | null {
  const caps = accessCapabilities(dialect);
  const { scope, principal, permissions } = request;

  if (!principal?.name?.trim()) return 'Choose a user or role first.';
  if (permissions.length === 0) return 'Choose at least one permission.';

  if (scope.type === 'database' && !caps.databaseScope) {
    return `${dialect} cannot grant at the database level.`;
  }
  if (scope.type === 'schema' && !caps.schemaScope) {
    return `${dialect} has no schema-level grants — select individual tables instead.`;
  }
  if (scope.type === 'tables') {
    if (!caps.tableScope) return `${dialect} cannot grant on individual tables.`;
    if (!scope.schema.trim()) return 'Choose the schema these tables live in.';
    if (scope.tables.length === 0) return 'Select at least one table.';
  }
  if (scope.type === 'columns') {
    if (!caps.columnScope) return `${dialect} cannot grant on individual columns.`;
    if (!scope.schema.trim()) return 'Choose the schema this table lives in.';
    if (!scope.table.trim()) return 'Enter the table name.';
    if (scope.columns.length === 0) return 'Select at least one column.';
  }
  if (scope.type === 'sequences') {
    if (!caps.sequenceScope) return `${dialect} cannot grant on sequences.`;
    if (!scope.schema.trim()) return 'Choose the schema these sequences live in.';
  }
  if (request.action === 'deny' && !caps.denyStatements) {
    return `${dialect} has no DENY statements — use revoke instead.`;
  }
  if (scope.type === 'schema' && !scope.schema.trim()) return 'Choose a schema.';
  if (scope.type === 'database' && !scope.database.trim()) return 'Choose a database.';

  if (request.includeFutureObjects && !caps.futureObjects) {
    // Not an error on engines whose schema grants already cover new objects —
    // handled as a warning below — but it is one where the toggle is simply
    // meaningless.
    if (scope.type === 'tables') {
      return 'Future objects do not apply when specific tables are selected.';
    }
  }
  if (request.withGrantOption && !caps.grantOption) {
    return `${dialect} does not support passing on privileges.`;
  }
  return null;
}

function warnFor(request: PermissionRequest, dialect: string): PermissionWarning[] {
  const warnings: PermissionWarning[] = [];
  const caps = accessCapabilities(dialect);
  const fam = accessFamily(dialect);
  const { permissions } = request;

  if (permissions.includes('drop-object')) {
    warnings.push({
      level: 'danger',
      message:
        'Drop objects permanently removes tables, views and their data. Review the generated SQL before running it.',
    });
  }
  if (request.withGrantOption) {
    warnings.push({
      level: 'danger',
      message:
        'With grant option lets this principal pass the same access to anyone else, which puts further grants outside your review.',
    });
  }
  if (permissions.some((p) => p === 'create-object' || p === 'alter-object')) {
    warnings.push({
      level: 'caution',
      message: 'Creating and altering objects changes the schema your migrations compare against.',
    });
  }
  if (request.includeFutureObjects && fam === 'postgres') {
    warnings.push({
      level: 'caution',
      message:
        'ALTER DEFAULT PRIVILEGES only applies to objects created by the role that runs it. Run it as the role that will own the new tables, or add FOR ROLE to name that owner explicitly.',
    });
  }
  if (request.includeFutureObjects && !caps.futureObjects && request.scope.type === 'schema') {
    warnings.push({
      level: 'info',
      message: `${dialect} has no separate future-objects grant — a schema-level grant already covers objects added later.`,
    });
  }
  if (request.action === 'revoke') {
    warnings.push({
      level: 'info',
      message:
        'Revoking removes only what was granted directly. Access inherited through a role stays until that role changes.',
    });
  }
  if (request.action === 'deny') {
    warnings.push({
      level: 'caution',
      message:
        'DENY overrides grants, including through roles. A direct DENY blocks access even when a role would grant it.',
    });
  }
  if (!KNOWN_FAMILIES.has(fam)) {
    warnings.push({
      level: 'caution',
      message: `Fox Schema has no privilege model for ${dialect}; the statements below use PostgreSQL's GRANT syntax. Check them against your engine before running them.`,
    });
  }
  return warnings;
}

/**
 * Build the statements for one request.
 *
 * Returns `{ error }` when the intent cannot be represented for this engine at
 * this scope, so the caller can say so instead of showing approximate SQL.
 */
export function buildAccessSql(
  request: PermissionRequest,
  dialect: string
): GeneratedPermissionSql | { error: string } {
  const invalid = validate(request, dialect);
  if (invalid) return { error: invalid };

  const fam = accessFamily(dialect);
  const grantee = formatDbGrantee(
    dialect,
    request.principal.name,
    request.principal.type === 'role' ? 'role' : 'user'
  );
  const ident = (n: string) => quoteSqlIdentifier(n, dialect);
  const verb =
    request.action === 'deny' ? 'DENY' : request.action === 'grant' ? 'GRANT' : 'REVOKE';
  const dir = request.action === 'revoke' ? 'FROM' : 'TO';
  const option = request.action === 'grant' && request.withGrantOption ? ' WITH GRANT OPTION' : '';

  const statements: GeneratedStatement[] = [];
  // Every emitter declares which requested permissions each statement accounts
  // for. Anything left over is a permission this engine's emitter cannot
  // express — the reader is told, instead of the intent quietly disappearing
  // between the checkbox they ticked and the SQL they copy.
  const covered = new Set<AccessPermission>();
  const add = (
    sql: string,
    explanation: string,
    risk: PermissionRisk,
    covers: readonly AccessPermission[] = []
  ) => {
    statements.push({ sql, explanation, risk });
    for (const p of covers) covered.add(p);
  };

  const emit =
    fam === 'mysql' || fam === 'mariadb'
      ? emitMysql
      : fam === 'sqlserver'
        ? emitSqlServer
        : fam === 'db2'
          ? emitDb2
          : fam === 'oracle'
            ? emitOracle
            : emitPostgres;

  emit({ request, dialect, grantee, ident, verb, dir, option, add });

  if (statements.length === 0) {
    return { error: 'That combination produces no statements for this engine.' };
  }

  const warnings = warnFor(request, dialect);
  const missed = request.permissions.filter((p) => !covered.has(p));
  if (missed.length > 0) {
    const labels = missed.map((p) => describePermission(p).label.toLowerCase());
    warnings.push({
      level: 'caution',
      message: `${dialect} cannot express ${listWords(labels)} at this scope — nothing below ${
        request.action === 'grant' ? 'grants' : 'revokes'
      } it. Handle ${missed.length === 1 ? 'that one' : 'those'} through object ownership or an engine-specific privilege.`,
    });
  }
  return {
    statements,
    warnings,
    risk: highestRisk(request.permissions, request.withGrantOption),
  };
}

interface EmitCtx {
  request: PermissionRequest;
  dialect: string;
  grantee: string;
  ident: (n: string) => string;
  verb: string;
  dir: string;
  option: string;
  add: (
    sql: string,
    explanation: string,
    risk: PermissionRisk,
    covers?: readonly AccessPermission[]
  ) => void;
}

// --- PostgreSQL family ------------------------------------------------------

function emitPostgres(ctx: EmitCtx): void {
  const { request, grantee, ident, verb, dir, option, add } = ctx;
  const { scope, permissions } = request;
  const privs = tablePrivileges(permissions);
  const tablePerms = tablePermissions(permissions);
  const schema = scopeSchema(scope);

  if (permissions.includes('connect') && scope.type === 'database') {
    add(
      `${verb} CONNECT ON DATABASE ${ident(scope.database)} ${dir} ${grantee}${option};`,
      `Lets ${request.principal.name} open a connection to ${scope.database}. On its own this grants no access to any data.`,
      'low',
      ['connect']
    );
  }

  // Reaching into a schema is a prerequisite the reader should not have to know
  // about — without USAGE, a SELECT grant silently does nothing. Only pair
  // USAGE with GRANTs (and with schema-wide REVOKEs). Revoking SELECT on one
  // table must not strip USAGE that other table grants still need.
  if (
    schema &&
    permissions.some((p) => p !== 'connect') &&
    (request.action === 'grant' ||
      (request.action === 'revoke' && (scope.type === 'schema' || scope.type === 'database')))
  ) {
    add(
      `${verb} USAGE ON SCHEMA ${ident(schema)} ${dir} ${grantee}${option};`,
      request.action === 'grant'
        ? `Lets ${request.principal.name} reach objects inside ${schema}. This alone does not allow reading any data.`
        : `Removes schema reachability for ${request.principal.name} in ${schema}.`,
      'low'
    );
  }

  if (privs.length > 0) {
    if (scope.type === 'columns') {
      const colList = scope.columns.map((c) => ident(c)).join(', ');
      add(
        `${verb} ${privs.join(', ')} (${colList}) ON ${ident(schema)}.${ident(scope.table)} ${dir} ${grantee}${option};`,
        `${describePrivs(privs)} on ${scope.columns.length} column(s) of ${schema}.${scope.table}.`,
        highestRisk(permissions),
        tablePerms
      );
    } else if (scope.type === 'tables') {
      for (const table of scope.tables) {
        add(
          `${verb} ${privs.join(', ')} ON ${ident(schema)}.${ident(table)} ${dir} ${grantee}${option};`,
          `${describePrivs(privs)} on ${schema}.${table}.`,
          highestRisk(permissions),
          tablePerms
        );
      }
    } else if (scope.type === 'schema') {
      add(
        `${verb} ${privs.join(', ')} ON ALL TABLES IN SCHEMA ${ident(schema)} ${dir} ${grantee}${option};`,
        `${describePrivs(privs)} on every table that exists in ${schema} right now. Tables created later are not included.`,
        highestRisk(permissions),
        tablePerms
      );
    } else {
      // PostgreSQL has no database-wide table grant: privileges are granted in
      // whichever database the session is connected to, one schema at a time.
      // Naming both facts beats a statement that looks broader than it is.
      add(
        `${verb} ${privs.join(', ')} ON ALL TABLES IN SCHEMA ${ident('public')} ${dir} ${grantee}${option};`,
        `${describePrivs(privs)} on every table in the public schema. Run it while connected to ${scope.database} — PostgreSQL applies grants to the current database only — and grant other schemas separately.`,
        highestRisk(permissions),
        tablePerms
      );
    }
  }

  if (request.includeFutureObjects && privs.length > 0 && scope.type === 'schema') {
    add(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${ident(schema)} ${verb} ${privs.join(', ')} ON TABLES ${dir} ${grantee};`,
      `Applies the same access to tables created in ${schema} from now on. Only affects tables created by the role that runs this statement.`,
      highestRisk(permissions),
      tablePerms
    );
  }

  if (permissions.some((p) => p === 'use-sequence' || (p === 'read' && scope.type === 'sequences'))) {
    const seqPerms: string[] = [];
    const seqCovers: AccessPermission[] = [];
    if (permissions.includes('use-sequence')) {
      seqPerms.push('USAGE');
      seqCovers.push('use-sequence');
    }
    if (permissions.includes('read') && scope.type === 'sequences') {
      seqPerms.push('SELECT');
      seqCovers.push('read');
    }
    if (seqPerms.length > 0 && schema) {
      if (scope.type === 'sequences' && scope.sequences?.length) {
        for (const seq of scope.sequences) {
          add(
            `${verb} ${seqPerms.join(', ')} ON SEQUENCE ${ident(schema)}.${ident(seq)} ${dir} ${grantee}${option};`,
            `Sequence access on ${schema}.${seq}.`,
            'low',
            seqCovers
          );
        }
      } else {
        add(
          `${verb} ${seqPerms.join(', ')} ON ALL SEQUENCES IN SCHEMA ${ident(schema)} ${dir} ${grantee}${option};`,
          `Sequence access on every sequence in ${schema}.`,
          'low',
          seqCovers
        );
      }
    }
  }

  if (permissions.includes('create-object')) {
    if (schema) {
      add(
        `${verb} CREATE ON SCHEMA ${ident(schema)} ${dir} ${grantee}${option};`,
        `Lets ${request.principal.name} create new objects inside ${schema}.`,
        'administrative',
        ['create-object']
      );
    } else if (scope.type === 'database') {
      add(
        `${verb} CREATE ON DATABASE ${ident(scope.database)} ${dir} ${grantee}${option};`,
        `Lets ${request.principal.name} create new schemas in ${scope.database}. Creating tables also needs CREATE on the schema that will hold them.`,
        'administrative',
        ['create-object']
      );
    }
  }

  const execPerms = executePermissions(permissions);
  if (execPerms.length > 0) {
    // At database scope PostgreSQL still needs a schema named; public is the
    // same assumption the table grant above makes, said out loud.
    const routineSchema = schema || 'public';
    add(
      `${verb} EXECUTE ON ALL ROUTINES IN SCHEMA ${ident(routineSchema)} ${dir} ${grantee}${option};`,
      `Lets ${request.principal.name} run functions and procedures that exist in ${routineSchema} now.`,
      'elevated',
      execPerms
    );
    if (request.includeFutureObjects) {
      add(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${ident(routineSchema)} ${verb} EXECUTE ON ROUTINES ${dir} ${grantee};`,
        `Applies the same to routines created in ${routineSchema} from now on.`,
        'elevated',
        execPerms
      );
    }
  }

  // ALTER and DROP are ownership in PostgreSQL, not grantable privileges — say
  // so rather than emitting SQL that will not do what the reader expects.
  const ownerPerms = ownershipPermissions(permissions);
  if (ownerPerms.length > 0) {
    add(
      // Membership runs role → member: the principal joins the owning role, not
      // the other way round.
      `-- PostgreSQL has no ALTER or DROP privilege: only an object's owner (or a\n-- member of its owning role) may alter or drop it. Consider:\n-- ${verb} <owning_role> ${dir} ${ident(request.principal.name)};`,
      'PostgreSQL controls altering and dropping through ownership, not grants. Add the principal to the owning role instead.',
      'critical',
      ownerPerms
    );
  }
}

// --- MySQL / MariaDB --------------------------------------------------------

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

// --- SQL Server / Azure SQL -------------------------------------------------

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

// --- IBM Db2 ----------------------------------------------------------------

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
    highestRisk(permissions),
    tablePerms
  );
}

// --- Oracle -----------------------------------------------------------------

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

// --- shared -----------------------------------------------------------------

const PRIV_VERB: Record<string, string> = {
  SELECT: 'Read',
  INSERT: 'Insert',
  UPDATE: 'Update',
  DELETE: 'Delete',
  EXECUTE: 'Run routines',
  CREATE: 'Create objects',
  ALTER: 'Alter objects',
  DROP: 'Drop objects',
};

/** "a", "a and b", "a, b and c" — one place, so every message reads the same. */
function listWords(words: readonly string[]): string {
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function describePrivs(privs: readonly string[]): string {
  return listWords(privs.map((p) => PRIV_VERB[p] ?? p));
}

/**
 * The mirror-image request, for the "Generate REVOKE SQL" affordance.
 *
 * Not a text transform of the generated SQL: some statements have no inverse
 * (ALTER DEFAULT PRIVILEGES needs its own REVOKE form), so the request is
 * flipped and regenerated.
 */
export function invertAccessRequest(request: PermissionRequest): PermissionRequest {
  const action: PermissionRequest['action'] =
    request.action === 'grant' ? 'revoke' : request.action === 'deny' ? 'revoke' : 'grant';
  return {
    ...request,
    action,
    // Passing on privileges is not something you revoke *with*; dropping the
    // flag keeps WITH GRANT OPTION out of the REVOKE statements.
    withGrantOption: false,
  };
}
