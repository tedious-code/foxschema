/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave — persistence.
 *
 * `@foxschema/sql` decides *what* changed; this decides what gets written. The
 * split is not cosmetic: that package must load in a browser bundle, so it may
 * not reach for `node:crypto` or a database handle.
 *
 * Three ideas carry the storage cost:
 *
 * 1. **Content addressing.** An object body is stored once per distinct hash,
 *    shared by every version and database that ever held it. Two hundred
 *    versions of an unchanged table cost one row, not two hundred.
 * 2. **Deltas.** A version records only the objects that changed. A
 *    20,000-object schema where three moved writes three rows.
 * 3. **A latest-state index.** The current hash of every live object, so a
 *    capture diffs against one batched read instead of replaying history.
 *    Older states are reconstructed by walking deltas *backwards* from it.
 *
 * Re-capturing an unchanged schema does not insert anything — it bumps a
 * counter on the existing version. A scheduled scan across twenty databases
 * would otherwise mint six-figure row counts a year for recording that nothing
 * happened.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  applyChanges,
  assembleBlueprint,
  buildRevertMigration,
  canonicalizeSchema,
  collapseObjectHistory,
  countSourceLines,
  databaseIdentity,
  hydrateTableSchemas,
  isLokeeTableLikeType,
  objectKeyKind,
  objectKeyOwner,
  planReversal,
  renderLokeeObjectScript,
  weave,
  type CanonicalObject,
  type DatabaseIdentityInput,
  type LokeeObjectType,
  type MigrationStep,
  type ObjectBlueprint,
  type ObjectChange,
  type ReversalPlan,
  type StoredWeaveObject,
  type TableSchema,
} from '@foxschema/sql';
import { getStore } from '../database/store';
import type { MetadataStore, SqlParam } from '../database/stores/types';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Bound on placeholders in one statement.
 *
 * SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999 on builds before 3.32 and
 * 32,766 after; the metadata store also runs on Postgres (65,535) and MySQL.
 * 900 is under every one of them, and the cost of being conservative is a few
 * more round trips on a schema large enough to care.
 */
const MAX_BIND_PARAMS = 900;

/** Objects returned for one graph window, before the view's own node cap. */
const MAX_GRAPH_OBJECT_KEYS = 400;

export type CaptureSource = 'migrate' | 'manual' | 'scan' | 'revert';

export interface CaptureInput extends DatabaseIdentityInput {
  tables: TableSchema[];
  source: CaptureSource;
  /** Links the version to the run that caused it — this is the attribution. */
  migrationRunId?: string;
}

export interface CaptureResult {
  databaseId: string;
  versionId: string;
  versionNumber: number;
  rootHash: string;
  /** False when the schema was byte-for-byte what the index already held. */
  changed: boolean;
  changeCount: number;
  objectCount: number;
}

export interface VersionedObject {
  hash: string;
  type: string;
  name: string;
  body: Record<string, unknown>;
  sourceText?: string | null;
  lineCount?: number | null;
  firstSeenAt?: string | null;
}

export interface ObjectHistoryEntry {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  source: CaptureSource;
  operation: 'ADD' | 'MODIFY' | 'DELETE';
  hash?: string;
  previousHash?: string;
  body?: Record<string, unknown>;
  previousBody?: Record<string, unknown>;
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
}

export interface ColumnMutation {
  objectKey: string;
  columnName: string;
  events: ObjectHistoryEntry[];
}

export interface ObjectInspectResult {
  blueprint: ObjectBlueprint;
  history: ObjectHistoryEntry[];
  growth: ContainerGrowthPoint[];
  /** Column ADD / MODIFY / DELETE across versions, when the focus is a table. */
  columnMutations: ColumnMutation[];
  /** CREATE script at this version (tables skip indexes). */
  script: string;
  /** Adjacent older version's script, empty on v1. */
  previousScript: string;
}

export interface RevertPlanResult {
  fromVersion: VersionSummary;
  toVersion: VersionSummary;
  alreadyAtTarget: boolean;
  reversal: ReversalPlan;
  steps: MigrationStep[];
  statements: string[];
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
  /** Optional user-facing label; null means show "Version N". */
  name?: string;
  description?: string;
  objectCount: number;
  changeCount: number;
}

interface VersionRow {
  id: string;
  version_number: number;
  root_hash: string;
  parent_version_id: string | null;
  migration_run_id: string | null;
  author_user_id: string | null;
  source: CaptureSource;
  object_count: number;
  change_count: number;
  observation_count: number;
  created_at: string;
  last_observed_at: string;
  display_name?: string | null;
  description?: string | null;
}

interface DeltaRow {
  version_id: string;
  object_key: string;
  operation: 'ADD' | 'MODIFY' | 'DELETE';
  object_hash: string | null;
  previous_hash: string | null;
  object_type: string | null;
}

/**
 * Serialises captures per database inside this process.
 *
 * Two concurrent captures would both read the same latest index, both compute
 * version N, and the second INSERT would hit the unique index on
 * `(database_id, version_number)` — the cross-process backstop. This queue
 * turns that error into a wait, which is what a caller actually wants.
 */
const captureLocks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = captureLocks.get(key) ?? Promise.resolve();
  // Chain onto the previous holder however it settled, so one failed capture
  // cannot wedge the lock for the rest of the process's life.
  const next = previous.then(work, work);
  // Store a never-rejecting handle: an unhandled rejection here would be an
  // unhandledRejection warning for an error the caller is already receiving.
  const guard = next.then(
    () => undefined,
    () => undefined
  );
  captureLocks.set(key, guard);
  void guard.then(() => {
    // Drop the entry only if nothing queued behind us, or we would erase a
    // waiter's turn and let two captures run at once.
    if (captureLocks.get(key) === guard) captureLocks.delete(key);
  });
  return next;
}

/** Split rows into batches that fit under the placeholder ceiling. */
export function chunkForBind<T>(rows: readonly T[], paramsPerRow: number): T[][] {
  const perChunk = Math.max(1, Math.floor(MAX_BIND_PARAMS / Math.max(1, paramsPerRow)));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) out.push(rows.slice(i, i + perChunk));
  return out;
}

function toCanonical(key: string, object: VersionedObject): CanonicalObject {
  return {
    key,
    type: object.type as LokeeObjectType,
    body: object.body,
    sourceText: object.sourceText,
  };
}

function canonicalList(objects: Map<string, VersionedObject>): CanonicalObject[] {
  return [...objects.entries()].map(([key, object]) => toCanonical(key, object));
}

/** `LIKE` prefix for children of one owner. `!` is the ESCAPE character. */
function likeOwnerPrefix(kind: string, owner: string): string {
  const escaped = owner.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
  return `${kind}:${escaped}.%`;
}

type HistoryDeltaRow = {
  version_id: string;
  version_number: number;
  created_at: string;
  source: CaptureSource;
  operation: 'ADD' | 'MODIFY' | 'DELETE';
  object_hash: string | null;
  previous_hash: string | null;
};

type ObjectBody = { body: Record<string, unknown>; lineCount: number | null; firstSeenAt: string | null };

function historyEntriesFromRows(
  rows: readonly HistoryDeltaRow[],
  bodies: ReadonlyMap<string, ObjectBody>
): ObjectHistoryEntry[] {
  const collapsed = collapseObjectHistory(
    rows.map((row) => ({
      versionId: row.version_id,
      createdAt: Date.parse(row.created_at) || 0,
      operation: row.operation,
      hash: row.object_hash ?? undefined,
    }))
  );
  const keep = new Set(collapsed.map((p) => `${p.versionId}:${p.operation}`));
  const out: ObjectHistoryEntry[] = [];
  for (const row of rows) {
    if (!keep.has(`${row.version_id}:${row.operation}`)) continue;
    const current = row.object_hash ? bodies.get(row.object_hash) : undefined;
    const previous = row.previous_hash ? bodies.get(row.previous_hash) : undefined;
    const firstSeen = current?.firstSeenAt ? Date.parse(current.firstSeenAt) : NaN;
    const versionAt = Date.parse(row.created_at) || 0;
    out.push({
      versionId: row.version_id,
      versionNumber: row.version_number,
      createdAt: row.created_at,
      source: row.source,
      operation: row.operation,
      hash: row.object_hash ?? undefined,
      previousHash: row.previous_hash ?? undefined,
      body: current?.body,
      previousBody: previous?.body,
      lineCount: current?.lineCount,
      previousLineCount: previous?.lineCount,
      firstSeenAt: current?.firstSeenAt,
      reused: Number.isFinite(firstSeen) && firstSeen + 1000 < versionAt,
    });
  }
  return out;
}

/**
 * Reconstruct the set of live objects at each version, newest first.
 *
 * Walks *backwards* from the latest index, inverting each version's delta. This
 * is why no checkpoint table exists: the newest state is already materialised,
 * and history is read from the recent end far more often than the ancient one.
 *
 * `versionsNewestFirst` must be contiguous and end at the head, or the inverted
 * deltas describe a state that never existed.
 */
export function reconstructStates(
  latest: ReadonlyMap<string, string>,
  versionsNewestFirst: readonly { id: string }[],
  deltasByVersion: ReadonlyMap<string, readonly DeltaRow[]>
): Map<string, Map<string, string>> {
  const states = new Map<string, Map<string, string>>();
  let current = new Map(latest);
  for (const version of versionsNewestFirst) {
    // The head's state is the latest index; each step back undoes one delta.
    states.set(version.id, new Map(current));
    const previous = new Map(current);
    for (const row of deltasByVersion.get(version.id) ?? []) {
      if (row.operation === 'ADD') previous.delete(row.object_key);
      else if (row.previous_hash != null) previous.set(row.object_key, row.previous_hash);
      else previous.delete(row.object_key);
    }
    current = previous;
  }
  return states;
}

export class LokeeWeaveStore {
  /** Injectable so tests can run against an in-memory SQLite metadata store. */
  constructor(private readonly resolveStore: () => Promise<MetadataStore> = getStore) {}

  private store(): Promise<MetadataStore> {
    return this.resolveStore();
  }

  /** Find or create the row for a database identity. Returns its row id. */
  private async upsertDatabase(
    store: MetadataStore,
    userId: string,
    input: DatabaseIdentityInput
  ): Promise<string> {
    const fingerprint = databaseIdentity(input, sha256);
    const now = new Date().toISOString();
    const find = async (): Promise<string | undefined> => {
      const row = await store.get<{ id: string }>(
        'SELECT id FROM lokee_databases WHERE user_id = ? AND fingerprint = ?',
        [userId, fingerprint]
      );
      return row?.id;
    };

    const existing = await find();
    if (existing) {
      await store.run('UPDATE lokee_databases SET last_seen_at = ? WHERE id = ?', [now, existing]);
      return existing;
    }

    const id = randomUUID();
    try {
      await store.run(
        `INSERT INTO lokee_databases
           (id, user_id, fingerprint, dialect, host, port, database_name, "schema", created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          fingerprint,
          input.dialect,
          input.host ?? null,
          input.port ?? null,
          input.database ?? null,
          input.schema ?? null,
          now,
          now,
        ]
      );
      return id;
    } catch (err) {
      // Another process inserted the same identity between the read and the
      // write. The unique index is what makes that safe; re-reading is the
      // resolution, and a still-missing row means the error was something else.
      const raced = await find();
      if (raced) return raced;
      throw err;
    }
  }

  /** The current hash of every live object, as one batched read. */
  private async loadLatestIndex(
    store: MetadataStore,
    databaseId: string
  ): Promise<Map<string, string>> {
    const rows = await store.all<{ object_key: string; object_hash: string }>(
      'SELECT object_key, object_hash FROM lokee_latest_objects WHERE database_id = ?',
      [databaseId]
    );
    return new Map(rows.map((r) => [r.object_key, r.object_hash]));
  }

  /** Insert object bodies that are not already stored. Content-addressed. */
  private async writeObjectBodies(
    store: MetadataStore,
    objects: readonly (CanonicalObject & { hash: string })[]
  ): Promise<void> {
    const byHash = new Map<string, CanonicalObject & { hash: string }>();
    for (const object of objects) if (!byHash.has(object.hash)) byHash.set(object.hash, object);
    const candidates = [...byHash.values()];
    if (candidates.length === 0) return;

    // Ask which hashes already exist rather than relying on INSERT-ignore
    // semantics, which differ across the three engines.
    const present = new Set<string>();
    for (const batch of chunkForBind(candidates, 1)) {
      const placeholders = batch.map(() => '?').join(', ');
      const rows = await store.all<{ hash: string }>(
        `SELECT hash FROM lokee_objects WHERE hash IN (${placeholders})`,
        batch.map((o) => o.hash)
      );
      for (const row of rows) present.add(row.hash);
    }

    const missing = candidates.filter((o) => !present.has(o.hash));
    if (missing.length === 0) return;
    const now = new Date().toISOString();
    const COLUMNS = 8;
    for (const batch of chunkForBind(missing, COLUMNS)) {
      const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params: SqlParam[] = [];
      for (const object of batch) {
        const sourceText =
          object.sourceText ??
          (typeof object.body.definition === 'string' ? object.body.definition : null);
        params.push(
          object.hash,
          object.key,
          object.type,
          typeof object.body.name === 'string' ? object.body.name : null,
          JSON.stringify(object.body),
          now,
          sourceText ? countSourceLines(sourceText) : null,
          sourceText
        );
      }
      await store.run(
        `INSERT INTO lokee_objects
           (hash, object_key, object_type, name, body_json, created_at, line_count, source_text)
         VALUES ${values}`,
        params
      );
    }
  }

  private async writeDelta(
    store: MetadataStore,
    versionId: string,
    changes: readonly ObjectChange[]
  ): Promise<void> {
    if (changes.length === 0) return;
    const COLUMNS = 6;
    for (const batch of chunkForBind(changes, COLUMNS)) {
      const values = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: SqlParam[] = [];
      for (const change of batch) {
        params.push(
          versionId,
          change.key,
          change.operation,
          change.hash ?? null,
          change.previousHash ?? null,
          change.type ?? null
        );
      }
      await store.run(
        `INSERT INTO lokee_version_objects
           (version_id, object_key, operation, object_hash, previous_hash, object_type)
         VALUES ${values}`,
        params
      );
    }
  }

  /** Move the latest-state index forward by one delta. */
  private async applyToLatestIndex(
    store: MetadataStore,
    databaseId: string,
    changes: readonly ObjectChange[]
  ): Promise<void> {
    const deletes = changes.filter((c) => c.operation === 'DELETE');
    for (const batch of chunkForBind(deletes, 1)) {
      const placeholders = batch.map(() => '?').join(', ');
      await store.run(
        `DELETE FROM lokee_latest_objects
          WHERE database_id = ? AND object_key IN (${placeholders})`,
        [databaseId, ...batch.map((c) => c.key)]
      );
    }
    const upserts = changes.filter((c) => c.operation !== 'DELETE' && c.hash != null);
    for (const change of upserts) {
      // upsert() is one row at a time, but it is the only portable
      // ON CONFLICT across SQLite / Postgres / MySQL. Only *changed* objects
      // reach here, so the row count is the size of the delta, not the schema.
      await store.upsert(
        'lokee_latest_objects',
        ['database_id', 'object_key'],
        {
          database_id: databaseId,
          object_key: change.key,
          object_hash: change.hash!,
          object_type: change.type ?? null,
        },
        ['object_hash', 'object_type']
      );
    }
  }

  /**
   * Capture the schema of a database.
   *
   * Creates a version only when the root hash moved. An unchanged schema is
   * recorded as another observation of the version already at the head.
   */
  async capture(userId: string, input: CaptureInput): Promise<CaptureResult> {
    const store = await this.store();
    // Lock on the identity, not the row id: the row may not exist yet, and two
    // concurrent first-captures would otherwise both try to create it.
    const lockKey = `${userId}:${databaseIdentity(input, sha256)}`;

    return withLock(lockKey, async () => {
      const databaseId = await this.upsertDatabase(store, userId, input);
      const latest = await this.loadLatestIndex(store, databaseId);
      const objects = canonicalizeSchema(input.tables);
      const capture = weave(objects, latest, sha256);

      const head = await store.get<VersionRow>(
        `SELECT * FROM lokee_versions WHERE database_id = ?
          ORDER BY version_number DESC LIMIT 1`,
        [databaseId]
      );

      const now = new Date().toISOString();

      // Nothing moved. Record that we looked, and stop — this is the branch
      // that keeps a scheduled scan from growing the table without bound.
      if (!capture.changed && head) {
        await store.run(
          `UPDATE lokee_versions
              SET observation_count = observation_count + 1, last_observed_at = ?
            WHERE id = ?`,
          [now, head.id]
        );
        return {
          databaseId,
          versionId: head.id,
          versionNumber: head.version_number,
          rootHash: head.root_hash,
          changed: false,
          changeCount: 0,
          objectCount: head.object_count,
        };
      }

      const versionId = randomUUID();
      const versionNumber = (head?.version_number ?? 0) + 1;

      await this.writeObjectBodies(store, capture.objects);
      await store.run(
        `INSERT INTO lokee_versions
           (id, database_id, version_number, root_hash, parent_version_id, migration_run_id,
            author_user_id, source, object_count, change_count, observation_count,
            created_at, last_observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          versionId,
          databaseId,
          versionNumber,
          capture.rootHash,
          head?.id ?? null,
          input.migrationRunId ?? null,
          userId,
          input.source,
          capture.objects.length,
          capture.changes.length,
          now,
          now,
        ]
      );
      await this.writeDelta(store, versionId, capture.changes);
      await this.applyToLatestIndex(store, databaseId, capture.changes);

      return {
        databaseId,
        versionId,
        versionNumber,
        rootHash: capture.rootHash,
        changed: true,
        changeCount: capture.changes.length,
        objectCount: capture.objects.length,
      };
    });
  }

  /** Databases this user has history for. */
  async listDatabases(userId: string): Promise<
    Array<{
      id: string;
      dialect: string;
      host?: string;
      database?: string;
      schema?: string;
      versionCount: number;
      lastSeenAt: string;
    }>
  > {
    const store = await this.store();
    const rows = await store.all<{
      id: string;
      dialect: string;
      host: string | null;
      database_name: string | null;
      schema: string | null;
      last_seen_at: string;
      version_count: number;
    }>(
      `SELECT d.id, d.dialect, d.host, d.database_name, d."schema", d.last_seen_at,
              (SELECT COUNT(*) FROM lokee_versions v WHERE v.database_id = d.id) AS version_count
         FROM lokee_databases d
        WHERE d.user_id = ?
        ORDER BY d.last_seen_at DESC`,
      [userId]
    );
    return rows.map((r) => ({
      id: r.id,
      dialect: r.dialect,
      host: r.host ?? undefined,
      database: r.database_name ?? undefined,
      schema: r.schema ?? undefined,
      versionCount: Number(r.version_count) || 0,
      lastSeenAt: r.last_seen_at,
    }));
  }

  /** Confirms the database belongs to this user before any read. */
  private async assertOwned(
    store: MetadataStore,
    userId: string,
    databaseId: string
  ): Promise<boolean> {
    const row = await store.get<{ id: string }>(
      'SELECT id FROM lokee_databases WHERE id = ? AND user_id = ?',
      [databaseId, userId]
    );
    return Boolean(row?.id);
  }

  /**
   * Revert plans from `databaseId` history but executes on a caller-supplied
   * connection. Refuse when that connection’s identity is not the same row —
   * otherwise DDL from one history can run against another database.
   */
  async matchDatabaseIdentity(
    userId: string,
    databaseId: string,
    input: DatabaseIdentityInput
  ): Promise<'ok' | 'not_found' | 'mismatch'> {
    const store = await this.store();
    const row = await store.get<{ fingerprint: string }>(
      'SELECT fingerprint FROM lokee_databases WHERE id = ? AND user_id = ?',
      [databaseId, userId]
    );
    if (!row) return 'not_found';
    return row.fingerprint === databaseIdentity(input, sha256) ? 'ok' : 'mismatch';
  }

  async listVersions(userId: string, databaseId: string, limit = 100): Promise<VersionSummary[]> {
    const store = await this.store();
    if (!(await this.assertOwned(store, userId, databaseId))) return [];
    const rows = await store.all<VersionRow>(
      `SELECT * FROM lokee_versions WHERE database_id = ?
        ORDER BY version_number DESC LIMIT ?`,
      [databaseId, Math.max(1, Math.min(500, limit))]
    );
    const authorIds = [
      ...new Set(rows.map((r) => r.author_user_id).filter((id): id is string => Boolean(id))),
    ];
    const emails = new Map<string, string>();
    if (authorIds.length) {
      const placeholders = authorIds.map(() => '?').join(', ');
      const users = await store.all<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE id IN (${placeholders})`,
        authorIds
      );
      for (const u of users) emails.set(u.id, u.email);
    }
    return rows.map((r) => ({
      id: r.id,
      number: r.version_number,
      rootHash: r.root_hash,
      createdAt: r.created_at,
      lastObservedAt: r.last_observed_at,
      observationCount: Number(r.observation_count) || 1,
      source: r.source,
      migrationRunId: r.migration_run_id ?? undefined,
      authorUserId: r.author_user_id ?? undefined,
      author: r.author_user_id
        ? emails.get(r.author_user_id) ?? r.author_user_id
        : undefined,
      name: r.display_name?.trim() || undefined,
      description: r.description?.trim() || undefined,
      objectCount: Number(r.object_count) || 0,
      changeCount: Number(r.change_count) || 0,
    }));
  }

  /**
   * Update the user-facing label and/or description on a version the caller owns.
   * Empty string clears the field (UI falls back to "Version N").
   */
  async updateVersionMeta(
    userId: string,
    databaseId: string,
    versionId: string,
    patch: { name?: string | null; description?: string | null }
  ): Promise<VersionSummary | null> {
    const store = await this.store();
    if (!(await this.assertOwned(store, userId, databaseId))) return null;
    const owned = await store.get<{ id: string }>(
      `SELECT id FROM lokee_versions WHERE id = ? AND database_id = ?`,
      [versionId, databaseId]
    );
    if (!owned?.id) return null;

    if (patch.name !== undefined) {
      const name = patch.name?.trim() ? patch.name.trim().slice(0, 120) : null;
      await store.run(`UPDATE lokee_versions SET display_name = ? WHERE id = ?`, [name, versionId]);
    }
    if (patch.description !== undefined) {
      const description = patch.description?.trim() ? patch.description.trim().slice(0, 4000) : null;
      await store.run(`UPDATE lokee_versions SET description = ? WHERE id = ?`, [
        description,
        versionId,
      ]);
    }

    const versions = await this.listVersions(userId, databaseId, 500);
    return versions.find((v) => v.id === versionId) ?? null;
  }

  /** Delta rows for a set of versions, batched to stay under the bind limit. */
  private async loadDeltas(
    store: MetadataStore,
    versionIds: readonly string[]
  ): Promise<Map<string, DeltaRow[]>> {
    const byVersion = new Map<string, DeltaRow[]>();
    for (const id of versionIds) byVersion.set(id, []);
    for (const batch of chunkForBind(versionIds, 1)) {
      const placeholders = batch.map(() => '?').join(', ');
      const rows = await store.all<DeltaRow>(
        `SELECT version_id, object_key, operation, object_hash, previous_hash, object_type
           FROM lokee_version_objects WHERE version_id IN (${placeholders})`,
        [...batch]
      );
      for (const row of rows) byVersion.get(row.version_id)?.push(row);
    }
    return byVersion;
  }

  /**
   * The DTO the version graph renders.
   *
   * Window is the most recent `limit` versions, so the walk back from the
   * latest index is bounded and the reconstructed states are contiguous with
   * the head — which `reconstructStates` requires.
   */
  async graph(
    userId: string,
    databaseId: string,
    limit = 20
  ): Promise<{
    databaseId: string;
    versions: Array<{
      id: string;
      number: number;
      createdAt: string;
      rootHash: string;
      author?: string;
      name?: string;
      description?: string;
    }>;
    objects: Array<{
      versionId: string;
      objectKey: string;
      name: string;
      objectType: LokeeObjectType;
      objectHash: string | null;
      status: 'added' | 'modified' | 'unchanged' | 'deleted';
    }>;
    totalVersions: number;
    totalObjects: number;
    truncatedObjects: boolean;
  }> {
    const store = await this.store();
    const empty = {
      databaseId,
      versions: [],
      objects: [],
      totalVersions: 0,
      totalObjects: 0,
      truncatedObjects: false,
    };
    if (!(await this.assertOwned(store, userId, databaseId))) return empty;

    const versions = await this.listVersions(userId, databaseId, limit);
    if (versions.length === 0) return empty;

    const totalRow = await store.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM lokee_versions WHERE database_id = ?',
      [databaseId]
    );
    const latest = await this.loadLatestIndex(store, databaseId);
    const deltas = await this.loadDeltas(
      store,
      versions.map((v) => v.id)
    );
    const states = reconstructStates(latest, versions, deltas);

    // Which objects to show. Anything that changed inside the window earns its
    // place; the rest fill the remaining budget so the graph still shows the
    // stable spine of the schema without trying to draw all 20,000 of them.
    const changedKeys = new Set<string>();
    for (const rows of deltas.values()) for (const row of rows) changedKeys.add(row.object_key);
    // `allKeys` is already the union of live and changed — a deleted object is
    // in `changedKeys` but not in `latest`, and an unchanged one the reverse.
    const allKeys = [...new Set([...latest.keys(), ...changedKeys])].sort();
    const keys = [
      ...[...changedKeys].sort(),
      ...allKeys.filter((k) => !changedKeys.has(k)),
    ].slice(0, MAX_GRAPH_OBJECT_KEYS);
    // Compare against the union, not union + changed: adding the two together
    // double-counts every changed key and reports truncation on a three-object
    // schema.
    const truncatedObjects = allKeys.length > keys.length;
    const keySet = new Set(keys);

    // Names and types for every hash in play, in batches.
    const hashes = new Set<string>();
    for (const state of states.values()) {
      for (const [key, hash] of state) if (keySet.has(key)) hashes.add(hash);
    }
    const meta = new Map<string, { name: string; type: string }>();
    for (const batch of chunkForBind([...hashes], 1)) {
      const placeholders = batch.map(() => '?').join(', ');
      const rows = await store.all<{ hash: string; name: string | null; object_type: string; object_key: string }>(
        `SELECT hash, name, object_type, object_key FROM lokee_objects WHERE hash IN (${placeholders})`,
        [...batch]
      );
      for (const row of rows) {
        meta.set(row.hash, {
          name: row.name ?? row.object_key.split(':').slice(1).join(':'),
          type: row.object_type,
        });
      }
    }

    const objects: Array<{
      versionId: string;
      objectKey: string;
      name: string;
      objectType: LokeeObjectType;
      objectHash: string | null;
      status: 'added' | 'modified' | 'unchanged' | 'deleted';
    }> = [];

    for (const version of versions) {
      const state = states.get(version.id) ?? new Map<string, string>();
      const delta = new Map((deltas.get(version.id) ?? []).map((r) => [r.object_key, r]));
      for (const key of keys) {
        const row = delta.get(key);
        const hash = state.get(key);
        if (row?.operation === 'DELETE') {
          objects.push({
            versionId: version.id,
            objectKey: key,
            name: fallbackName(key),
            objectType: (row.object_type as LokeeObjectType) ?? 'table',
            objectHash: null,
            status: 'deleted',
          });
          continue;
        }
        // Absent from this version's state and not deleted in it: the object
        // did not exist yet. Emitting nothing is what stops the graph from
        // inventing a node before the object was created.
        if (hash == null) continue;
        const info = meta.get(hash);
        objects.push({
          versionId: version.id,
          objectKey: key,
          name: info?.name ?? fallbackName(key),
          objectType: (info?.type as LokeeObjectType) ?? (row?.object_type as LokeeObjectType) ?? 'table',
          objectHash: hash,
          status:
            row?.operation === 'ADD' ? 'added' : row?.operation === 'MODIFY' ? 'modified' : 'unchanged',
        });
      }
    }

    return {
      databaseId,
      versions: versions.map((v) => ({
        id: v.id,
        number: v.number,
        createdAt: v.createdAt,
        rootHash: v.rootHash,
        author: v.author,
        name: v.name,
        description: v.description,
      })),
      objects,
      totalVersions: Number(totalRow?.n) || versions.length,
      totalObjects: latest.size,
      truncatedObjects,
    };
  }

  /**
   * Every live object at a version, with its stored body. Used by revert and by
   * the object inspector; reconstructed by walking back from the latest index.
   */
  async objectsAtVersion(
    userId: string,
    databaseId: string,
    versionId: string
  ): Promise<Map<string, VersionedObject>> {
    const store = await this.store();
    const out = new Map<string, VersionedObject>();
    if (!(await this.assertOwned(store, userId, databaseId))) return out;

    const target = await store.get<VersionRow>(
      'SELECT * FROM lokee_versions WHERE id = ? AND database_id = ?',
      [versionId, databaseId]
    );
    if (!target) return out;

    // Every version from the head down to the target, inclusive.
    const chain = await store.all<VersionRow>(
      `SELECT * FROM lokee_versions
        WHERE database_id = ? AND version_number >= ?
        ORDER BY version_number DESC`,
      [databaseId, target.version_number]
    );
    const latest = await this.loadLatestIndex(store, databaseId);
    const deltas = await this.loadDeltas(
      store,
      chain.map((v) => v.id)
    );
    const states = reconstructStates(latest, chain, deltas);
    const state = states.get(versionId) ?? new Map<string, string>();

    for (const batch of chunkForBind([...new Set(state.values())], 1)) {
      const placeholders = batch.map(() => '?').join(', ');
      const rows = await store.all<{
        hash: string;
        object_key: string;
        object_type: string;
        name: string | null;
        body_json: string;
        source_text: string | null;
        line_count: number | null;
        created_at: string | null;
      }>(
        `SELECT hash, object_key, object_type, name, body_json, source_text, line_count, created_at
           FROM lokee_objects WHERE hash IN (${placeholders})`,
        [...batch]
      );
      for (const row of rows) {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(row.body_json) as Record<string, unknown>;
        } catch {
          // A corrupt body must not take down a whole version read; the object
          // still exists and its identity is still known.
        }
        out.set(row.object_key, {
          hash: row.hash,
          type: row.object_type,
          name: row.name ?? fallbackName(row.object_key),
          body,
          sourceText: row.source_text,
          lineCount: row.line_count,
          firstSeenAt: row.created_at,
        });
      }
    }
    return out;
  }

  /**
   * Inspector payload: blueprint at a version, change timeline for one key,
   * and per-version child counts so a table's growth is visible.
   */
  async inspectObject(
    userId: string,
    databaseId: string,
    versionId: string,
    objectKey: string
  ): Promise<ObjectInspectResult | null> {
    const store = await this.store();
    if (!(await this.assertOwned(store, userId, databaseId))) return null;

    const atVersion = await this.objectsAtVersion(userId, databaseId, versionId);
    const stored = new Map<string, StoredWeaveObject>();
    for (const [key, object] of atVersion) stored.set(key, { key, ...object });
    const owner = objectKeyOwner(objectKey);
    const kind = objectKeyKind(objectKey);
    const blueprint = assembleBlueprint(objectKey, stored);
    // Growth is about the parent table/view, so clicking a column still counts.
    const tableLike = isLokeeTableLikeType(String(blueprint.container?.type ?? kind));
    const script = renderLokeeObjectScript(blueprint);
    let previousScript = '';
    const versions = await this.listVersions(userId, databaseId, 500);
    const here = versions.findIndex((v) => v.id === versionId);
    const older = here >= 0 ? versions[here + 1] : undefined;
    if (older) {
      const prevAt = await this.objectsAtVersion(userId, databaseId, older.id);
      const prevStored = new Map<string, StoredWeaveObject>();
      for (const [key, object] of prevAt) prevStored.set(key, { key, ...object });
      previousScript = renderLokeeObjectScript(assembleBlueprint(objectKey, prevStored));
    }
    return {
      blueprint,
      history: await this.objectHistory(userId, databaseId, objectKey),
      growth: tableLike ? await this.containerGrowth(userId, databaseId, owner) : [],
      columnMutations: tableLike ? await this.columnMutations(userId, databaseId, owner) : [],
      script,
      previousScript,
    };
  }

  /**
   * Classify + generate DDL that moves the live head back to `toVersionId`.
   *
   * `dialect` / `schema` come from the connection the caller will execute
   * against (preferred) or the stored database identity.
   */
  async planRevert(
    userId: string,
    databaseId: string,
    toVersionId: string,
    dialect?: string,
    schema?: string
  ): Promise<RevertPlanResult | null> {
    const store = await this.store();
    if (!(await this.assertOwned(store, userId, databaseId))) return null;

    const versions = await this.listVersions(userId, databaseId, 500);
    const fromVersion = versions[0];
    const toVersion = versions.find((v) => v.id === toVersionId);
    if (!fromVersion || !toVersion) return null;

    const none: RevertPlanResult = {
      fromVersion,
      toVersion,
      alreadyAtTarget: fromVersion.id === toVersion.id,
      reversal: planReversal([]),
      steps: [],
      statements: [],
    };
    if (none.alreadyAtTarget) return none;

    const current = await this.objectsAtVersion(userId, databaseId, fromVersion.id);
    const desired = await this.objectsAtVersion(userId, databaseId, toVersion.id);
    const entries: Array<{ key: string; current?: CanonicalObject; target?: CanonicalObject }> = [];
    for (const key of new Set([...current.keys(), ...desired.keys()])) {
      const cur = current.get(key);
      const tgt = desired.get(key);
      if (cur && tgt && cur.hash === tgt.hash) continue;
      entries.push({
        key,
        current: cur ? toCanonical(key, cur) : undefined,
        target: tgt ? toCanonical(key, tgt) : undefined,
      });
    }

    let dialectName = dialect;
    let schemaName = schema;
    if (!dialectName) {
      const db = await store.get<{ dialect: string; schema: string | null }>(
        'SELECT dialect, "schema" FROM lokee_databases WHERE id = ? AND user_id = ?',
        [databaseId, userId]
      );
      dialectName = db?.dialect;
      schemaName ??= db?.schema ?? undefined;
    }

    const migration = dialectName
      ? await buildRevertMigration(
          hydrateTableSchemas(canonicalList(current)),
          hydrateTableSchemas(canonicalList(desired)),
          dialectName,
          { targetSchema: schemaName, sourceSchema: schemaName }
        )
      : { steps: [] as MigrationStep[], statements: [] as string[] };

    return {
      fromVersion,
      toVersion,
      alreadyAtTarget: false,
      reversal: planReversal(entries),
      steps: migration.steps,
      statements: migration.statements,
    };
  }

  async objectHistory(
    userId: string,
    databaseId: string,
    objectKey: string
  ): Promise<ObjectHistoryEntry[]> {
    const store = await this.store();
    if (!(await this.assertOwned(store, userId, databaseId))) return [];

    const rows = await store.all<HistoryDeltaRow>(
      `SELECT vo.operation, vo.object_hash, vo.previous_hash,
              v.id AS version_id, v.version_number, v.created_at, v.source
         FROM lokee_version_objects vo
         INNER JOIN lokee_versions v ON v.id = vo.version_id
        WHERE v.database_id = ? AND vo.object_key = ?
        ORDER BY v.version_number ASC`,
      [databaseId, objectKey]
    );
    if (rows.length === 0) return [];

    const bodies = await this.loadObjectBodies(store, rows);
    return historyEntriesFromRows(rows, bodies);
  }

  private async columnMutations(
    userId: string,
    databaseId: string,
    owner: string
  ): Promise<ColumnMutation[]> {
    const store = await this.store();
    if (!(await this.assertOwned(store, userId, databaseId))) return [];

    const rows = await store.all<HistoryDeltaRow & { object_key: string }>(
      `SELECT vo.object_key, vo.operation, vo.object_hash, vo.previous_hash,
              v.id AS version_id, v.version_number, v.created_at, v.source
         FROM lokee_version_objects vo
         INNER JOIN lokee_versions v ON v.id = vo.version_id
        WHERE v.database_id = ? AND vo.object_key LIKE ? ESCAPE '!'
        ORDER BY vo.object_key ASC, v.version_number ASC`,
      [databaseId, likeOwnerPrefix('column', owner)]
    );
    if (rows.length === 0) return [];

    const bodies = await this.loadObjectBodies(store, rows);
    const byKey = new Map<string, Array<HistoryDeltaRow & { object_key: string }>>();
    for (const row of rows) {
      const list = byKey.get(row.object_key) ?? [];
      list.push(row);
      byKey.set(row.object_key, list);
    }

    return [...byKey.entries()].flatMap(([objectKey, group]) => {
      const events = historyEntriesFromRows(group, bodies);
      if (events.length === 0) return [];
      const named = events.find((e) => typeof e.body?.name === 'string')?.body?.name;
      return [
        {
          objectKey,
          columnName: typeof named === 'string' ? named : objectKey.slice(objectKey.lastIndexOf('.') + 1),
          events,
        },
      ];
    });
  }

  private async loadObjectBodies(
    store: MetadataStore,
    rows: readonly Pick<HistoryDeltaRow, 'object_hash' | 'previous_hash'>[]
  ): Promise<Map<string, ObjectBody>> {
    const hashes = new Set<string>();
    for (const row of rows) {
      if (row.object_hash) hashes.add(row.object_hash);
      if (row.previous_hash) hashes.add(row.previous_hash);
    }
    const bodies = new Map<string, ObjectBody>();
    for (const batch of chunkForBind([...hashes], 1)) {
      const placeholders = batch.map(() => '?').join(', ');
      const found = await store.all<{
        hash: string;
        body_json: string;
        line_count: number | null;
        created_at: string | null;
      }>(
        `SELECT hash, body_json, line_count, created_at FROM lokee_objects WHERE hash IN (${placeholders})`,
        [...batch]
      );
      for (const row of found) {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(row.body_json) as Record<string, unknown>;
        } catch {
          /* keep empty */
        }
        bodies.set(row.hash, {
          body,
          lineCount: row.line_count,
          firstSeenAt: row.created_at,
        });
      }
    }
    return bodies;
  }

  private async containerGrowth(
    userId: string,
    databaseId: string,
    owner: string
  ): Promise<ContainerGrowthPoint[]> {
    const versions = await this.listVersions(userId, databaseId, 20);
    if (versions.length === 0) return [];
    const store = await this.store();
    const latest = await this.loadLatestIndex(store, databaseId);
    const deltas = await this.loadDeltas(
      store,
      versions.map((v) => v.id)
    );
    const states = reconstructStates(latest, versions, deltas);
    const points: ContainerGrowthPoint[] = [];
    for (const version of [...versions].reverse()) {
      const state = states.get(version.id) ?? new Map<string, string>();
      let columns = 0;
      let indexes = 0;
      let foreignKeys = 0;
      let triggers = 0;
      let objects = 0;
      for (const key of state.keys()) {
        if (objectKeyOwner(key) !== owner) continue;
        objects += 1;
        const kind = objectKeyKind(key);
        if (kind === 'column') columns += 1;
        else if (kind === 'index') indexes += 1;
        else if (kind === 'foreign_key') foreignKeys += 1;
        else if (kind === 'trigger') triggers += 1;
      }
      points.push({
        versionId: version.id,
        versionNumber: version.number,
        createdAt: version.createdAt,
        columns,
        indexes,
        foreignKeys,
        triggers,
        objects,
      });
    }
    return points;
  }

  /**
   * Delete object bodies no version references any more.
   *
   * Bodies are shared across databases, so this cannot be folded into the
   * cascade on `lokee_databases` — a row may still be in use by another
   * database's history.
   */
  async collectGarbage(): Promise<number> {
    const store = await this.store();
    const result = await store.run(
      `DELETE FROM lokee_objects
        WHERE hash NOT IN (SELECT object_hash FROM lokee_latest_objects)
          AND hash NOT IN (SELECT object_hash FROM lokee_version_objects WHERE object_hash IS NOT NULL)
          AND hash NOT IN (SELECT previous_hash FROM lokee_version_objects WHERE previous_hash IS NOT NULL)`
    );
    return result.changes;
  }
}

/** `column:CUSTOMER.EMAIL` → `CUSTOMER.EMAIL`, for rows with no stored name. */
function fallbackName(objectKey: string): string {
  const colon = objectKey.indexOf(':');
  return colon >= 0 ? objectKey.slice(colon + 1) : objectKey;
}
