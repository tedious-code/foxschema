/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * App RBAC catalog: roles + permission keys + default grants.
 * Shared by API guards and the frontend UI (do not put Node-only imports here).
 */

/**
 * Ordered least → most privileged. `owner` sits between editor and admin:
 * full power over database schema and data (including GRANT and deploying
 * migrations), but no say over who may use the app — that stays with `admin`.
 */
export const APP_ROLES = ['viewer', 'editor', 'owner', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

/** Fine-grained capabilities enforced on API + UI. */
export const PERMISSIONS = [
  // Schema Sync
  'schema.browse',
  'schema.compare',
  'schema.migrate',
  // SQL Editor
  'editor.access',
  'editor.run',
  // `editor.write` is the legacy umbrella, kept so grants saved before the
  // dml/ddl split keep working. New grants should use the finer keys below.
  'editor.write',
  'editor.dml',
  'editor.ddl',
  'editor.grant',
  'editor.advanced',
  'editor.variables.read',
  'editor.variables.write',
  'editor.variables.delete',
  'editor.sidebar.destinations',
  'editor.sidebar.bookmarks',
  'editor.sidebar.variables',
  'editor.sidebar.secrets',
  'editor.sidebar.utilities',
  'editor.sidebar.schema',
  'editor.datagrid.insert',
  'editor.datagrid.update',
  'editor.datagrid.delete',
  // Utilities (standalone + sidebar)
  'utility.access',
  // Secrets vault
  'secrets.view',
  'secrets.create',
  'secrets.edit',
  'secrets.delete',
  // Administration
  'admin.users',
  'admin.roles',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export interface PermissionMeta {
  id: Permission;
  group: string;
  label: string;
  description: string;
}

export const PERMISSION_META: PermissionMeta[] = [
  { id: 'schema.browse', group: 'Schema Sync', label: 'Browse schema', description: 'Load and inspect schema trees.' },
  { id: 'schema.compare', group: 'Schema Sync', label: 'Compare schemas', description: 'Run source vs target compare.' },
  { id: 'schema.migrate', group: 'Schema Sync', label: 'Execute migrations', description: 'Deploy generated migration SQL.' },
  { id: 'editor.access', group: 'SQL Editor', label: 'Open SQL Editor', description: 'Switch to the SQL Editor workspace.' },
  { id: 'editor.run', group: 'SQL Editor', label: 'Run queries', description: 'Execute SELECT / read statements.' },
  { id: 'editor.write', group: 'SQL Editor', label: 'Run writes (legacy)', description: 'Umbrella kept for grants made before the DML/DDL split; implies both.' },
  { id: 'editor.dml', group: 'SQL Editor', label: 'Change data', description: 'INSERT / UPDATE / DELETE / MERGE and bulk load — row changes, no schema change.' },
  { id: 'editor.ddl', group: 'SQL Editor', label: 'Change schema', description: 'CREATE / ALTER / DROP / TRUNCATE on tables, views, indexes, procedures and functions.' },
  { id: 'editor.grant', group: 'SQL Editor', label: 'Grant privileges', description: 'GRANT / REVOKE. Separate because it can escalate what an account may do.' },
  { id: 'editor.advanced', group: 'SQL Editor', label: 'Advanced / code cells', description: 'Run JS/TS/Node code cells and advanced editor tools.' },
  { id: 'editor.variables.read', group: 'SQL Editor', label: 'View variables', description: 'See SQL Editor variables.' },
  { id: 'editor.variables.write', group: 'SQL Editor', label: 'Edit variables', description: 'Create and update variables.' },
  { id: 'editor.variables.delete', group: 'SQL Editor', label: 'Delete variables', description: 'Remove variables.' },
  { id: 'editor.sidebar.destinations', group: 'SQL Editor sidebar', label: 'Destinations', description: 'Show Destinations section.' },
  { id: 'editor.sidebar.bookmarks', group: 'SQL Editor sidebar', label: 'Bookmarks', description: 'Show Bookmarks section.' },
  { id: 'editor.sidebar.variables', group: 'SQL Editor sidebar', label: 'Variables', description: 'Show Variables section.' },
  { id: 'editor.sidebar.secrets', group: 'SQL Editor sidebar', label: 'Secrets', description: 'Show Secrets vault section.' },
  { id: 'editor.sidebar.utilities', group: 'SQL Editor sidebar', label: 'Utilities', description: 'Show Utilities section.' },
  { id: 'editor.sidebar.schema', group: 'SQL Editor sidebar', label: 'Schema', description: 'Show Schema explorer section.' },
  { id: 'editor.datagrid.insert', group: 'Data grid', label: 'Insert rows', description: 'Add / clone rows in Data Peek and editable query-result grids (also needs Change data).' },
  { id: 'editor.datagrid.update', group: 'Data grid', label: 'Update rows', description: 'Edit rows in Data Peek and editable query-result grids (also needs Change data).' },
  { id: 'editor.datagrid.delete', group: 'Data grid', label: 'Delete rows', description: 'Delete rows in Data Peek and editable query-result grids (also needs Change data).' },
  { id: 'utility.access', group: 'Utilities', label: 'Use utilities', description: 'Run Clone Table, Index Management, Server Insights, etc.' },
  { id: 'secrets.view', group: 'Secrets', label: 'View secrets', description: 'List secrets (values still resolved only when needed).' },
  { id: 'secrets.create', group: 'Secrets', label: 'Add secrets', description: 'Create vault entries and cloud provider credentials.' },
  { id: 'secrets.edit', group: 'Secrets', label: 'Edit secrets', description: 'Update existing secrets and provider credentials.' },
  { id: 'secrets.delete', group: 'Secrets', label: 'Delete secrets', description: 'Remove secrets and provider credentials.' },
  { id: 'admin.users', group: 'Admin', label: 'Manage users', description: 'List users and assign roles.' },
  { id: 'admin.roles', group: 'Admin', label: 'Configure roles', description: 'Edit which permissions each role receives.' },
];

const ALL = [...PERMISSIONS];

const VIEWER: Permission[] = [
  'schema.browse',
  'schema.compare',
  'editor.access',
  'editor.run',
  'editor.variables.read',
  'editor.sidebar.destinations',
  'editor.sidebar.bookmarks',
  'editor.sidebar.variables',
  'editor.sidebar.schema',
];

const EDITOR: Permission[] = [
  ...VIEWER,
  // Data and schema on the objects an editor owns day to day. No GRANT (cannot
  // widen its own access) and no schema.migrate (deploying a generated plan to
  // a target database has a blast radius beyond one statement) — both on OWNER.
  'editor.dml',
  'editor.ddl',
  'editor.advanced',
  'editor.variables.write',
  'editor.variables.delete',
  'editor.sidebar.secrets',
  'editor.sidebar.utilities',
  'editor.datagrid.insert',
  'editor.datagrid.update',
  'editor.datagrid.delete',
  'utility.access',
  'secrets.view',
  'secrets.create',
  'secrets.edit',
];

/** Everything an editor has, plus privilege changes and migration deploys. */
const OWNER: Permission[] = [
  ...EDITOR,
  'schema.migrate',
  'editor.grant',
  'secrets.delete',
];

const ADMIN: Permission[] = ALL;

/** Built-in defaults when role_permissions has no rows for a role. */
export const DEFAULT_ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  viewer: VIEWER,
  editor: EDITOR,
  owner: OWNER,
  admin: ADMIN,
};

export function uniquePermissions(list: Iterable<unknown>): Permission[] {
  const out: Permission[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    if (!isPermission(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Permission a statement category demands. `read` needs none beyond
 * `editor.run`, which the route already requires.
 */
export const CATEGORY_PERMISSION: Record<'read' | 'dml' | 'ddl' | 'grant', Permission | null> = {
  read: null,
  dml: 'editor.dml',
  ddl: 'editor.ddl',
  grant: 'editor.grant',
};

/** Permission required for Data Peek / query-result grid row actions. */
export const DATAGRID_ACTION_PERMISSION: Record<
  'insert' | 'update' | 'delete',
  Permission
> = {
  insert: 'editor.datagrid.insert',
  update: 'editor.datagrid.update',
  delete: 'editor.datagrid.delete',
};

export function isDatagridAction(value: unknown): value is 'insert' | 'update' | 'delete' {
  return value === 'insert' || value === 'update' || value === 'delete';
}

/**
 * True when `granted` satisfies `needed`. The retired `editor.write` umbrella
 * still covers dml and ddl so grants saved before the split keep working — it
 * deliberately does NOT cover `editor.grant`, which was carved out precisely
 * because it can escalate privileges.
 */
export function permissionSatisfied(granted: Iterable<Permission>, needed: Permission): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has(needed)) return true;
  if (needed === 'editor.dml' || needed === 'editor.ddl') return set.has('editor.write');
  return false;
}
