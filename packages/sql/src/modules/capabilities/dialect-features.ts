/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which of Fox Schema's features an engine actually supports.
 *
 * The answer already existed, four times, in four shapes: `supportsAccessBuilder`
 * returned a bare boolean, `userManagementSupport` a record with a reason,
 * command mode a registry lookup, and row editing a `Set` of dialect names in
 * the frontend. Each answered its own screen, none answered "can this engine do
 * this at all", and the screen with no gate offered itself to everything.
 *
 * Schema Compare was that screen, and it failed silently rather than awkwardly:
 * `resolveDialect` falls back to Db2 for a name it does not know, so a Redis or
 * MongoDB connection reaching the compare pipeline generated **Db2 DDL**.
 * Nothing errored.
 *
 * ## Derived, not declared
 *
 * The first version of this file lived in `modules/dialect`, a foundation
 * domain that `architecture.test.ts` forbids from importing `access` or
 * `command-mode` — so it re-declared all four answers by hand and needed a
 * consistency test to catch the inevitable drift. That constraint was
 * self-inflicted: the rule is one-directional, and a domain that nothing
 * imports back may depend on all three. Moving the file here lets it *ask* the
 * features instead of copying them, which deletes the drift and the test that
 * policed it. You cannot disagree with yourself.
 *
 * What stays declared is only what nothing else owns: `rowEditing`, and the
 * short sentences explaining a missing control.
 *
 * The engine roster comes from `PROVIDER_SETTINGS`, whose own comment promises
 * "register a new dialect by adding its settings here — nothing else changes".
 * A second hand-maintained list here would have broken that promise silently:
 * a new engine would have fallen through as unknown and lost every feature
 * with no test failing.
 */
import { tryResolveDialect } from '../dialect/registry.js';
import { supportsAccessBuilder } from '../access/intent.js';
import { userManagementSupport } from '../access/user-sql.js';
import { nonSqlPermissionsReason } from '../access/non-sql-engines.js';
import { supportsCommandMode } from '../command-mode/cli.registry.js';
import { PROVIDER_SETTINGS } from '../../providers/provider-settings.js';

/** A top-level feature, one per control the app can offer for a connection. */
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

/**
 * Whether one feature is available, and why not when it is not.
 *
 * A union rather than `{ supported: boolean; reason?: string }`, because the
 * reason is never actually optional: every refusal carries one. Typing it as
 * optional pushed a dead fallback onto callers for a branch that cannot
 * happen, and let one of them render an empty notice box.
 *
 * Deliberately shorter than the message a feature gives when it refuses an
 * action: this explains a missing control, that explains a refused request.
 */
export type FeatureSupport =
  | { supported: true; reason?: undefined }
  | { supported: false; reason: string };

export type DialectFeatureSupport = Record<DialectFeature, FeatureSupport>;

/** The engine's own name, so a sentence does not read "mongodb has no…". */
function label(key: string): string {
  return PROVIDER_SETTINGS[key]?.label ?? key;
}

/**
 * Reasons no other module owns.
 *
 * Everything absent here is derived below, and its reason comes from whichever
 * module already answers that question — `userManagementSupport` most of all,
 * which has carried a per-engine reason since long before this file.
 */
const DECLARED: Record<string, Partial<Record<DialectFeature, string>>> = {
  clickhouse: {
    // The SQL Editor adapter is deliberately read-write for SQLite but not for
    // ClickHouse — see the acquire() comments in each adapter.
    rowEditing: 'The SQL Editor adapter rejects writes for ClickHouse.',
  },
  redis: {
    schemaCompare: 'Redis has no schema to compare — keys are not tables.',
    commandMode: 'Redis does not take SQL, so there is nothing to hand to a client.',
  },
  mongodb: {
    schemaCompare: 'MongoDB has no schema to compare — collections are not tables.',
    commandMode: 'MongoDB does not take SQL, so there is nothing to hand to a client.',
  },
};

/** The reason a derived `false` needs, when the source of the answer has none. */
function fallbackReason(key: string, feature: DialectFeature): string {
  return `Fox Schema does not offer ${feature} for ${label(key)}.`;
}

function support(supported: boolean, reason: () => string | undefined): FeatureSupport {
  if (supported) return { supported: true };
  return { supported: false, reason: reason() ?? '' };
}

function buildFeatures(key: string): DialectFeatureSupport {
  const declared = DECLARED[key] ?? {};
  const say = (feature: DialectFeature, otherwise?: string) =>
    declared[feature] ?? otherwise ?? fallbackReason(key, feature);

  return Object.freeze({
    // Exactly the engines with a SQL dialect — asked, not listed, so adding one
    // to DIALECT_MAP cannot leave this behind.
    schemaCompare: support(tryResolveDialect(key) !== undefined, () => say('schemaCompare')),
    dbAccess: support(supportsAccessBuilder(key), () =>
      say('dbAccess', nonSqlPermissionsReason(key) ?? `Fox Schema has no permission builder for ${label(key)} yet.`)
    ),
    // This one already carries its own per-engine wording.
    userManagement: support(userManagementSupport(key).supported, () =>
      say('userManagement', userManagementSupport(key).reason)
    ),
    commandMode: support(supportsCommandMode(key), () => say('commandMode')),
    // Nothing else owns this, so it is declared here and read from here.
    rowEditing: support(!declared.rowEditing, () => declared.rowEditing),
  });
}

/**
 * Built once per engine and shared, because the answer is static and one
 * caller sits in a component that re-renders on every checkbox. Frozen so the
 * sharing is safe by construction rather than by everyone happening to read.
 *
 * Only known engines are cached: an unknown one puts its own name in the
 * reason, so its record cannot be shared, and caching would grow without
 * bound on arbitrary input.
 */
const CACHE = new Map<string, DialectFeatureSupport>();

function unknownFeatures(dialect: string): DialectFeatureSupport {
  const reason = (feature: DialectFeature) =>
    `Fox Schema does not know ${dialect || 'this engine'}, so it cannot offer ${feature}.`;
  const out = {} as DialectFeatureSupport;
  for (const feature of DIALECT_FEATURES) {
    out[feature] = { supported: false, reason: reason(feature) };
  }
  return Object.freeze(out);
}

/** Every feature answer for one engine. Unknown engines support nothing. */
export function dialectFeatures(dialect: string): DialectFeatureSupport {
  const key = (dialect || '').toLowerCase();
  if (!(key in PROVIDER_SETTINGS)) return unknownFeatures(dialect);
  const cached = CACHE.get(key);
  if (cached) return cached;
  const built = buildFeatures(key);
  CACHE.set(key, built);
  return built;
}

/** Whether one feature is available, for a caller that needs only the flag. */
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

/**
 * Why this pair of engines cannot be compared, or null when they can.
 *
 * Comparing takes two connections and either side disqualifies it, so the
 * button and the store were asking the same two-part question in two copies
 * that had already drifted by one guard clause. One answer cannot disagree
 * with itself.
 */
export function schemaCompareBlocker(source: string, target: string): string | null {
  for (const [side, dialect] of [
    ['Source', source],
    ['Target', target],
  ] as const) {
    const answer = dialectFeatures(dialect).schemaCompare;
    if (!answer.supported) return `${side}: ${answer.reason}`;
  }
  return null;
}

/** Engines this answers for, which is every engine a connection can use. */
export function knownDialects(): string[] {
  return Object.keys(PROVIDER_SETTINGS).sort();
}
