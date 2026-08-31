/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave — the shapes that cross the wire.
 *
 * One declaration per contract, imported by the backend that produces it and
 * the frontend that consumes it. Before this file each of these existed twice —
 * once in `lokee-weave.module.ts`, once hand-copied into `lokeeApi.ts` — and
 * nothing checked the copies against each other, so renaming a field
 * type-checked cleanly on both sides and broke only in the browser. Two had
 * already drifted: `source` was widened from a four-value union to `string`,
 * and `VersionGraphObject.schemaName` was declared on a field no producer ever
 * emitted.
 *
 * `apps/web/tsconfig.json` includes both `src` and `../../packages`, so the
 * repo's primary gate typechecks producer, contract and consumer in one pass.
 *
 * These belong here rather than in `@foxschema/sql` because they are *this
 * app's* API contract, not dialect knowledge: they carry metadata-DB primary
 * keys, user ids, and row counters, none of which mean anything outside
 * FoxSchema. `@foxschema/sql` is published to npm, and putting app wire shapes
 * in it would bind them to that package's semver. Types that genuinely are
 * dialect knowledge — `ObjectBlueprint`, `StoredWeaveObject`, `ReversalPlan`,
 * `ChangeOperation`, `LokeeObjectType` — stay there and are re-exported below
 * where the wire needs them.
 */
import type {
  ChangeOperation,
  SchemaCompareResult,
  LokeeObjectType,
  ObjectBlueprint,
  ObjectChangeKind,
  ReversalPlan,
  TableDiff,
} from '@foxschema/sql';

/** How a version came to exist. */
export type CaptureSource = 'migrate' | 'manual' | 'scan' | 'revert';

export interface CaptureResult {
  databaseId: string;
  versionId: string;
  versionNumber: number;
  rootHash: string;
  /**
   * False when the schema was byte-for-byte what the index already held.
   * Not derivable from `changeCount`: a first capture of an empty schema is
   * `changed: true, changeCount: 0` — a real version with no deltas.
   */
  changed: boolean;
  changeCount: number;
  objectCount: number;
}

export interface LokeeDatabase {
  id: string;
  dialect: string;
  host?: string;
  database?: string;
  schema?: string;
  versionCount: number;
  lastSeenAt: string;
}

export interface VersionSummary {
  id: string;
  number: number;
  rootHash: string;
  createdAt: string;
  lastObservedAt: string;
  observationCount: number;
  source: CaptureSource;
  migrationRunId?: string;
  authorUserId?: string;
  /** Resolved email (or id) for filters / attribution. */
  author?: string;
  /** Optional user-facing label; absent means show "Version N". */
  name?: string;
  description?: string;
  objectCount: number;
  changeCount: number;
  /**
   * Set only on a version a revert produced: the head the database was at, and
   * the version that was restored. `source: 'revert'` says an undo happened;
   * these say which one, which is the question you ask when reading it back.
   */
  revertFromVersionId?: string;
  revertToVersionId?: string;
}

export interface ObjectHistoryEntry {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  source: CaptureSource;
  operation: ChangeOperation;
  hash?: string;
  previousHash?: string;
  body?: Record<string, unknown>;
  previousBody?: Record<string, unknown>;
  // Absent and null differ here and both reach the client: `undefined` means
  // the row was not found, `null` means it was found and carries no value.
  lineCount?: number | null;
  previousLineCount?: number | null;
  firstSeenAt?: string | null;
  /** True when this hash was stored before this version — a pointer, not a copy. */
  reused: boolean;
}

export interface ContainerGrowthPoint {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  columns: number;
  indexes: number;
  foreignKeys: number;
  triggers: number;
  objects: number;
  /** True when this container changed in this version — the roadmap's markers. */
  changed?: boolean;
}

export interface ColumnMutation {
  objectKey: string;
  columnName: string;
  events: ObjectHistoryEntry[];
}

export interface ObjectInspectResult {
  blueprint: ObjectBlueprint;
  /**
   * This object at this version against the version before it, in the shape
   * Compare Schema already speaks, so the inspector renders the same blueprint
   * tables rather than a second one kept in step by hand. Null when the object
   * has no container (nothing to diff).
   */
  diff: TableDiff | null;
  history: ObjectHistoryEntry[];
  growth: ContainerGrowthPoint[];
  /** Column ADD / MODIFY / DELETE across versions, when the focus is a table. */
  columnMutations: ColumnMutation[];
  /** CREATE script at this version (tables skip indexes). */
  script: string;
  /** Adjacent older version's script; empty string on v1. */
  previousScript: string;
}

export type GraphChangeStatus = 'added' | 'modified' | 'unchanged' | 'deleted';

export interface VersionGraphVersion {
  id: string;
  /** 1-based, shown to the user as `v3` when no custom name is set. */
  number: number;
  createdAt: string;
  rootHash: string;
  /** Who ran the migration that produced this version, when known. */
  author?: string;
  /** Optional display name; falls back to `Version ${number}`. */
  name?: string;
  description?: string;
  /** How the version came to exist — a revert node is worth marking. */
  source?: CaptureSource;
  /** Version number this revert restored, when this version is one. */
  revertedToNumber?: number;
}

export interface VersionGraphObject {
  versionId: string;
  /** Logical identity — never the hash. A rename is a delete plus an add. */
  objectKey: string;
  name: string;
  objectType: LokeeObjectType;
  /** Content identity. Null for a tombstone. */
  objectHash: string | null;
  status: GraphChangeStatus;
  /**
   * For a container, which kinds of child changed in this version — columns,
   * data types, constraints, indexes, triggers. `status: 'modified'` alone is
   * true of a renamed comment and of a dropped column, and the reader cannot
   * tell those apart from the node.
   */
  changeKinds?: ObjectChangeKind[];
}

export interface VersionGraphDTO {
  databaseId: string;
  versions: VersionGraphVersion[];
  objects: VersionGraphObject[];
  /** Totals for the whole history, not just the returned window. */
  totalVersions: number;
  totalObjects: number;
  /** True when the object cap hid part of the schema. Always sent. */
  truncatedObjects: boolean;
}

/**
 * A revert plan as published.
 *
 * `RevertPlanResult` (backend-only) also carries `steps: MigrationStep[]`,
 * which the routes strip before responding. Deriving the wire shape keeps that
 * omission deliberate instead of re-typed.
 */
export interface RevertPlanWire {
  fromVersion: VersionSummary;
  toVersion: VersionSummary;
  alreadyAtTarget: boolean;
  reversal: ReversalPlan;
  statements: string[];
}

/**
 * Why a revert was refused. Named once; three call sites narrow on it.
 * `connection_mismatch` guards reverting through a connection that does not
 * point at the database the history belongs to.
 */
export type LokeeRevertErrorCode =
  | 'blocked'
  | 'confirm_lossy'
  | 'connection_mismatch'
  /**
   * The pre-revert snapshot found the live schema had moved since the last
   * capture. The plan the caller reviewed was computed against the old picture,
   * so it is refused rather than applied — re-read the new diff and decide
   * again.
   */
  | 'schema_drifted'
  | 'failed';

/**
 * A version compared against another (its parent, unless one is named).
 *
 * `compare` is the same `SchemaCompareResult` the live Compare Schema flow
 * produces — one diff engine, not two. `from` is the source side (older) and
 * `to` the target (newer), matching Compare's own vocabulary.
 */
export interface VersionCompare {
  /** Null when `to` is the first version — nothing precedes it. */
  from: VersionSummary | null;
  to: VersionSummary;
  compare: SchemaCompareResult;
  /**
   * Dialect the history was captured under. The DDL Diff pane renders real
   * CREATE statements, which are dialect-specific; null on a pre-existing row
   * with no recorded dialect.
   */
  dialect: string | null;
}
