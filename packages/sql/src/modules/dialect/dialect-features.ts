/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which of Fox Schema's features an engine actually supports.
 *
 * The answer already existed, four times, in four different shapes:
 * `supportsAccessBuilder` returned a bare boolean, `userManagementSupport` a
 * record with a reason, command mode a registry lookup, and row editing a Set
 * of dialect names in the frontend. Each answered its own screen and none
 * answered "can this engine do this at all", so a screen with no gate offered
 * itself to everything.
 *
 * Schema Compare was that screen, and the failure was silent rather than
 * awkward: `resolveDialect` falls back to Db2 for a name it does not know, so
 * a Redis or MongoDB connection reaching the compare pipeline generated **Db2
 * DDL** — confirmed by resolving both and identifying the strategy that came
 * back. Nothing errored. The reader would have got a migration script for the
 * wrong engine entirely.
 *
 * So the default here is the opposite one. An engine absent from the table
 * supports nothing, and adding a dialect means saying what it can do rather
 * than inheriting a yes by omission.
 *
 * ## Why this is a declaration and not a derivation
 *
 * `dialect` is a foundation domain: `architecture.test.ts` forbids it from
 * importing `access` or `command-mode`, so this cannot call those functions to
 * compute an answer. That is the right constraint anyway — this is the
 * top-level "should the tab exist" question, while each feature module keeps
 * its own finer detail and its own wording for refusing one action.
 *
 * The cost of a declaration is drift, so `dialect-features.consistency.test.ts`
 * (outside `modules/`, where it may import both) asserts this table and those
 * functions agree for every engine. If they ever disagree, that test fails
 * rather than a user finding out.
 */

/** A top-level feature, one per screen the app can offer for a connection. */
export type DialectFeature =
  /** Compare two schemas and generate the migration DDL. */
  | 'schemaCompare'
  /** Build GRANT/REVOKE statements. */
  | 'dbAccess'
  /** Create, alter and drop accounts. */
  | 'userManagement'
  /** Wrap a statement in the engine's own client for a terminal. */
  | 'commandMode'
  /** Edit result rows in the grid, and apply a data comparison. */
  | 'rowEditing';

export const DIALECT_FEATURES: readonly DialectFeature[] = [
  'schemaCompare',
  'dbAccess',
  'userManagement',
  'commandMode',
  'rowEditing',
];

export interface FeatureSupport {
  supported: boolean;
  /**
   * Why not, in one line, for the UI to show in place of a dead control.
   *
   * Deliberately shorter than the message the feature itself gives when it
   * refuses an action: this one explains a missing tab, that one explains a
   * refused request, and they are read at different moments.
   */
  reason?: string;
}

export type DialectFeatureSupport = Record<DialectFeature, FeatureSupport>;

/**
 * Features an engine cannot do, and why. Anything unlisted is supported.
 *
 * An engine must appear here to be considered known at all — see the note
 * above about the Db2 fallback.
 */
const UNSUPPORTED: Record<string, Partial<Record<DialectFeature, string>>> = {
  postgres: {},
  mysql: {},
  mariadb: {},
  tidb: {},
  cockroachdb: {},
  yugabytedb: {},
  redshift: {},
  sqlserver: {},
  azuresql: {},
  oracle: {},
  db2: {},

  clickhouse: {
    // ClickHouse does have GRANT — `GRANT SELECT ON default.* TO user` was
    // accepted by a live server. What is missing is a Fox Schema access
    // builder for it, which is why this says so rather than blaming the engine.
    dbAccess: 'Fox Schema has no permission builder for ClickHouse yet.',
    rowEditing: 'The SQL Editor adapter rejects writes for ClickHouse.',
  },

  // A file's owner is the access control, so these two really have neither.
  sqlite: {
    dbAccess: 'SQLite has no grants — the file’s permissions are the access control.',
    userManagement: 'SQLite has no database accounts.',
  },
  duckdb: {
    dbAccess: 'DuckDB has no grants — the file’s permissions are the access control.',
    userManagement: 'DuckDB has no database accounts.',
  },

  // Both have accounts and permissions; neither is reachable through SQL, and
  // neither has a schema to diff. Query and row editing stay on, because the
  // adapters do support them — MongoDB through executeDataMigrateOps, Redis
  // through its own write path.
  redis: {
    schemaCompare: 'Redis has no schema to compare — keys are not tables.',
    dbAccess: 'Redis permissions are ACL rules, not SQL grants. Use redis-cli.',
    userManagement: 'Redis accounts are managed with ACL SETUSER, not SQL. Use redis-cli.',
    commandMode: 'Redis does not take SQL, so there is nothing to hand to a client.',
  },
  mongodb: {
    schemaCompare: 'MongoDB has no schema to compare — collections are not tables.',
    dbAccess: 'MongoDB permissions are roles, not SQL grants. Use mongosh.',
    userManagement: 'MongoDB accounts are managed with db.createUser, not SQL. Use mongosh.',
    commandMode: 'MongoDB does not take SQL, so there is nothing to hand to a client.',
  },
};

const UNKNOWN_REASON = (dialect: string, feature: DialectFeature): string =>
  `Fox Schema does not know ${dialect || 'this engine'}, so it cannot offer ${feature}.`;

/** Every feature answer for one engine. Unknown engines support nothing. */
export function dialectFeatures(dialect: string): DialectFeatureSupport {
  const key = (dialect || '').toLowerCase();
  const entry = UNSUPPORTED[key];
  const out = {} as DialectFeatureSupport;
  for (const feature of DIALECT_FEATURES) {
    if (!entry) {
      out[feature] = { supported: false, reason: UNKNOWN_REASON(dialect, feature) };
      continue;
    }
    const reason = entry[feature];
    out[feature] = reason ? { supported: false, reason } : { supported: true };
  }
  return out;
}

/** Whether one feature is available, for a call site that needs only the flag. */
export function supportsDialectFeature(dialect: string, feature: DialectFeature): boolean {
  return dialectFeatures(dialect)[feature].supported;
}

/** Why a feature is unavailable, or undefined when it is available. */
export function dialectFeatureReason(
  dialect: string,
  feature: DialectFeature
): string | undefined {
  return dialectFeatures(dialect)[feature].reason;
}

/** Engines this table knows, for tests and for a "supported engines" listing. */
export function knownDialects(): string[] {
  return Object.keys(UNSUPPORTED).sort();
}
