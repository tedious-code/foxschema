/**
 * The Database Access Assistant's intent model.
 *
 * The point of this layer is that the UI never speaks SQL. A reader says "let
 * this user read the reporting schema, including tables made later" and the
 * dialect generators work out that PostgreSQL needs three statements for it
 * while SQL Server needs one. Everything here is database-independent; nothing
 * in this file may know a GRANT keyword.
 *
 * FoxSchema does not apply access changes — it explains and generates. The
 * database stays the source of truth.
 */

/**
 * What a reader wants, not what the engine calls it.
 *
 * `read` is not `SELECT`: on a schema scope it also implies whatever the engine
 * needs to reach into that schema at all (Postgres USAGE), which is exactly the
 * detail this model exists to hide.
 */
export type AccessPermission =
  | 'connect'
  | 'read'
  | 'insert'
  | 'update'
  | 'delete'
  | 'create-object'
  | 'alter-object'
  | 'drop-object'
  | 'execute-function'
  | 'execute-procedure';

export const ACCESS_PERMISSIONS: readonly AccessPermission[] = [
  'connect',
  'read',
  'insert',
  'update',
  'delete',
  'create-object',
  'alter-object',
  'drop-object',
  'execute-function',
  'execute-procedure',
];

export interface AccessPrincipal {
  type: 'user' | 'role';
  name: string;
}

export type AccessScope =
  | { type: 'database'; database: string }
  | { type: 'schema'; database?: string; schema: string }
  | { type: 'tables'; database?: string; schema: string; tables: string[] };

export interface PermissionRequest {
  principal: AccessPrincipal;
  action: 'grant' | 'revoke';
  permissions: AccessPermission[];
  scope: AccessScope;
  /**
   * Apply the same access to objects created after this runs. Only meaningful
   * where `AccessCapabilities.futureObjects` is true — the generator refuses
   * rather than pretending, because silently dropping it would leave the reader
   * believing future tables are covered when they are not.
   */
  includeFutureObjects?: boolean;
  /** Let the grantee pass this access on. Always Critical risk. */
  withGrantOption?: boolean;
}

/**
 * How much damage this permission can do if the grant is wrong.
 *
 * Deliberately blunt: readers scanning a list need four buckets they can act
 * on, not a numeric score they have to interpret.
 */
export type PermissionRisk = 'low' | 'elevated' | 'administrative' | 'critical';

export const PERMISSION_RISK: Record<AccessPermission, PermissionRisk> = {
  connect: 'low',
  read: 'low',
  insert: 'elevated',
  update: 'elevated',
  delete: 'elevated',
  'execute-function': 'elevated',
  'execute-procedure': 'elevated',
  'create-object': 'administrative',
  'alter-object': 'administrative',
  'drop-object': 'critical',
};

const RISK_ORDER: readonly PermissionRisk[] = ['low', 'elevated', 'administrative', 'critical'];

/** The highest risk in a set — what a summary badge should show. */
export function highestRisk(
  permissions: readonly AccessPermission[],
  withGrantOption = false
): PermissionRisk {
  // WITH GRANT OPTION lets the grantee re-grant to anyone, so it outranks the
  // privileges it is attached to however tame those are on their own.
  if (withGrantOption) return 'critical';
  let worst: PermissionRisk = 'low';
  for (const p of permissions) {
    const risk = PERMISSION_RISK[p];
    if (RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(worst)) worst = risk;
  }
  return worst;
}

/** Plain-English label plus the privilege name a DBA would recognise. */
export interface PermissionDescriptor {
  permission: AccessPermission;
  label: string;
  /** The engine-neutral privilege this usually maps to; shown as secondary text. */
  privilegeHint: string;
  description: string;
  risk: PermissionRisk;
}

/** Risk lives in `PERMISSION_RISK` only; descriptors read it rather than restate it. */
export const PERMISSION_DESCRIPTORS: readonly PermissionDescriptor[] = (
  [
    { permission: 'connect', label: 'Connect to database', privilegeHint: 'CONNECT', description: 'Allows opening a connection. Without it nothing else applies.' },
    { permission: 'read', label: 'Read data', privilegeHint: 'SELECT', description: 'Allows reading rows.' },
    { permission: 'insert', label: 'Insert data', privilegeHint: 'INSERT', description: 'Allows adding new rows.' },
    { permission: 'update', label: 'Update data', privilegeHint: 'UPDATE', description: 'Allows changing existing rows.' },
    { permission: 'delete', label: 'Delete data', privilegeHint: 'DELETE', description: 'Allows removing rows.' },
    { permission: 'create-object', label: 'Create objects', privilegeHint: 'CREATE', description: 'Allows creating tables, views and other objects.' },
    { permission: 'alter-object', label: 'Alter objects', privilegeHint: 'ALTER', description: 'Allows changing object definitions.' },
    { permission: 'drop-object', label: 'Drop objects', privilegeHint: 'DROP', description: 'Allows permanently removing objects.' },
    { permission: 'execute-function', label: 'Execute functions', privilegeHint: 'EXECUTE', description: 'Allows running functions.' },
    { permission: 'execute-procedure', label: 'Execute procedures', privilegeHint: 'EXECUTE', description: 'Allows running stored procedures.' },
  ] as const
).map((d) => ({ ...d, risk: PERMISSION_RISK[d.permission] }));

const DESCRIPTOR_BY_PERMISSION = new Map(PERMISSION_DESCRIPTORS.map((d) => [d.permission, d]));

export function describePermission(permission: AccessPermission): PermissionDescriptor {
  // Every member of the union is in the table; the fallback keeps callers from
  // having to handle undefined for a case that cannot happen.
  return DESCRIPTOR_BY_PERMISSION.get(permission) ?? PERMISSION_DESCRIPTORS[0];
}

export type AccessPreset =
  | 'read-only'
  | 'read-write'
  | 'application-writer'
  | 'procedure-executor'
  | 'schema-developer'
  | 'custom';

/**
 * Presets answer "what should this user be able to do?" — the question a reader
 * can actually answer — instead of "which privileges do you want?", which
 * assumes they already know.
 */
export const ACCESS_PRESETS: Record<Exclude<AccessPreset, 'custom'>, AccessPermission[]> = {
  'read-only': ['connect', 'read'],
  'read-write': ['connect', 'read', 'insert', 'update', 'delete'],
  // Deliberately no delete: the common shape for an application account that
  // should never be able to erase history.
  'application-writer': ['connect', 'read', 'insert', 'update'],
  'procedure-executor': ['connect', 'execute-function', 'execute-procedure'],
  'schema-developer': [
    'connect',
    'read',
    'insert',
    'update',
    'delete',
    'create-object',
    'alter-object',
  ],
};

export function permissionsForPreset(preset: AccessPreset): AccessPermission[] {
  if (preset === 'custom') return [];
  return [...ACCESS_PRESETS[preset]];
}

/** The preset a permission set matches exactly, or 'custom' when it matches none. */
export function presetForPermissions(permissions: readonly AccessPermission[]): AccessPreset {
  const target = [...permissions].sort().join(',');
  for (const [preset, list] of Object.entries(ACCESS_PRESETS)) {
    if ([...list].sort().join(',') === target) return preset as AccessPreset;
  }
  return 'custom';
}

/**
 * What an engine can actually express, so the UI never offers a control that
 * cannot produce valid SQL.
 */
export interface AccessCapabilities {
  /** Scope levels the engine can grant at. */
  databaseScope: boolean;
  schemaScope: boolean;
  tableScope: boolean;
  /** Grants that apply to objects created later (Postgres DEFAULT PRIVILEGES). */
  futureObjects: boolean;
  /** Separate CONNECT-style privilege, rather than connection being implicit. */
  connectPrivilege: boolean;
  /** EXECUTE can be granted across a whole schema, not just per routine. */
  schemaWideExecute: boolean;
  /** WITH GRANT OPTION (or the engine's equivalent). */
  grantOption: boolean;
}

const CAPABILITIES: Record<string, AccessCapabilities> = {
  postgres: {
    databaseScope: true,
    schemaScope: true,
    tableScope: true,
    futureObjects: true,
    connectPrivilege: true,
    schemaWideExecute: true,
    grantOption: true,
  },
  mysql: {
    databaseScope: true,
    // MySQL's "database" and "schema" are the same thing, so a separate schema
    // scope would be a second control for one concept.
    schemaScope: false,
    tableScope: true,
    futureObjects: false,
    // Reaching the server is governed by the account itself, not a privilege.
    connectPrivilege: false,
    schemaWideExecute: true,
    grantOption: true,
  },
  mariadb: {
    databaseScope: true,
    schemaScope: false,
    tableScope: true,
    futureObjects: false,
    connectPrivilege: false,
    schemaWideExecute: true,
    grantOption: true,
  },
  sqlserver: {
    databaseScope: true,
    schemaScope: true,
    tableScope: true,
    // No DEFAULT PRIVILEGES equivalent: a schema-level grant already covers
    // objects added later, which the generator explains rather than silently
    // ignoring the toggle.
    futureObjects: false,
    connectPrivilege: true,
    schemaWideExecute: true,
    grantOption: true,
  },
  db2: {
    databaseScope: true,
    schemaScope: true,
    tableScope: true,
    futureObjects: false,
    connectPrivilege: true,
    schemaWideExecute: false,
    grantOption: true,
  },
  oracle: {
    databaseScope: true,
    // Oracle schemas are users; granting "on a schema" is not a thing, so the
    // builder offers table scope and system privileges instead.
    schemaScope: false,
    tableScope: true,
    futureObjects: false,
    connectPrivilege: true,
    schemaWideExecute: false,
    grantOption: true,
  },
};

/** Dialects that behave as another engine for access purposes. */
export function accessFamily(dialect: string): string {
  const d = (dialect || '').toLowerCase();
  if (d === 'azuresql') return 'sqlserver';
  if (d === 'tidb') return 'mysql';
  // Postgres-wire engines share the privilege model. Redshift is included
  // because its GRANT syntax follows Postgres even though its catalogs differ.
  if (d === 'cockroachdb' || d === 'yugabytedb' || d === 'redshift') return 'postgres';
  return d;
}

const NO_ACCESS: AccessCapabilities = {
  databaseScope: false,
  schemaScope: false,
  tableScope: false,
  futureObjects: false,
  connectPrivilege: false,
  schemaWideExecute: false,
  grantOption: false,
};

/**
 * Engines with no GRANT model at all. Returning empty capabilities lets the UI
 * say so plainly instead of rendering a builder that can only fail.
 */
const UNSUPPORTED_DIALECTS = new Set(['sqlite', 'duckdb', 'clickhouse', 'mongodb', 'redis']);

/** Always a fresh object: callers must not be able to edit the shared table. */
export function accessCapabilities(dialect: string): AccessCapabilities {
  if (UNSUPPORTED_DIALECTS.has((dialect || '').toLowerCase())) return { ...NO_ACCESS };
  return { ...(CAPABILITIES[accessFamily(dialect)] ?? CAPABILITIES.postgres) };
}

export function supportsAccessBuilder(dialect: string): boolean {
  const caps = accessCapabilities(dialect);
  return caps.databaseScope || caps.schemaScope || caps.tableScope;
}

/** Permissions this engine can express at this scope, in display order. */
export function availablePermissions(
  dialect: string,
  scopeType: AccessScope['type']
): AccessPermission[] {
  const caps = accessCapabilities(dialect);
  return ACCESS_PERMISSIONS.filter((p) => {
    if (p === 'connect') return caps.connectPrivilege && scopeType === 'database';
    // Creating and dropping objects is a schema/database concern; offering it
    // against a chosen table would be meaningless.
    if (p === 'create-object' || p === 'alter-object' || p === 'drop-object') {
      return scopeType !== 'tables';
    }
    // EXECUTE is offered only where the engine can grant it across a set of
    // routines. Db2 and Oracle grant it one routine at a time, and offering it
    // at database scope there produced a checkbox no statement could honour.
    if (p === 'execute-function' || p === 'execute-procedure') {
      return scopeType !== 'tables' && caps.schemaWideExecute;
    }
    return true;
  });
}
