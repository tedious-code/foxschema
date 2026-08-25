/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave — client for the schema-versioning endpoints.
 *
 * Capture posts a `ConnectionRef`, never credentials: a saved connection is
 * resolved and decrypted server-side, and an ad-hoc one carries only what the
 * user typed for this session.
 */
import type { StoredWeaveObject } from '@foxschema/sql';
import type { ConnectionRef } from './schemaApi';
import type { VersionGraphDTO } from '../components/lokee-weave/graphTypes';
import type { CaptureResult, LokeeDatabase, LokeeRevertErrorCode, ObjectHistoryEntry, ObjectInspectResult, RevertPlanWire, VersionCompare, VersionSummary } from '@foxschema/shared';
import { getApiBase, parseJsonBody, parseJsonResponse } from './apiBase';

// These were hand-copied from the backend until the shared contract landed;
// two had already drifted (`source` widened to `string`). Aliases keep the
// existing call sites while the declaration lives in one place.
export type { CaptureResult, LokeeDatabase } from '@foxschema/shared';
export type LokeeVersion = VersionSummary;
export type LokeeHistoryEvent = ObjectHistoryEntry;
export type LokeeStoredObject = StoredWeaveObject;
export type LokeeInspectResult = ObjectInspectResult;
export type LokeeRevertPlan = RevertPlanWire;

/**
 * Capture the current schema of a database.
 *
 * Returns `changed: false` when the schema is byte-for-byte what the last
 * version held — that is the normal outcome, not an error, and the UI should
 * say "no changes since v4" rather than reporting a failed capture.
 */
export async function captureSchema(
  ref: ConnectionRef & { source?: 'manual' | 'migrate' | 'revert'; migrationRunId?: string }
): Promise<CaptureResult> {
  const res = await fetch(`${getApiBase()}/lokee/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(ref),
  });
  return parseJsonResponse<CaptureResult>(res);
}

export async function listLokeeDatabases(): Promise<LokeeDatabase[]> {
  const res = await fetch(`${getApiBase()}/lokee/databases`, { credentials: 'include' });
  const body = await parseJsonResponse<{ databases: LokeeDatabase[] }>(res);
  return body.databases ?? [];
}

export async function listLokeeVersions(
  databaseId: string,
  limit = 100
): Promise<LokeeVersion[]> {
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/versions?limit=${limit}`,
    { credentials: 'include' }
  );
  const body = await parseJsonResponse<{ versions: LokeeVersion[] }>(res);
  return body.versions ?? [];
}

/** The DTO the version graph renders. `limit` is a count of versions. */
export async function loadVersionGraph(
  databaseId: string,
  limit = 20
): Promise<VersionGraphDTO> {
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/graph?limit=${limit}`,
    { credentials: 'include' }
  );
  return parseJsonResponse<VersionGraphDTO>(res);
}

/** Update the user-facing name and/or description on a version. */
export async function updateLokeeVersionMeta(
  databaseId: string,
  versionId: string,
  patch: { name?: string | null; description?: string | null }
): Promise<LokeeVersion> {
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/versions/${encodeURIComponent(versionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch),
    }
  );
  const body = await parseJsonResponse<{ version: LokeeVersion }>(res);
  return body.version;
}

/** Blueprint + change timeline for one object at one version. */
export async function inspectLokeeObject(
  databaseId: string,
  versionId: string,
  objectKey: string
): Promise<LokeeInspectResult> {
  const params = new URLSearchParams({ versionId, objectKey });
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/inspect?${params}`,
    { credentials: 'include' }
  );
  return parseJsonResponse<LokeeInspectResult>(res);
}

export class LokeeRevertError extends Error {
  readonly code: LokeeRevertErrorCode;
  readonly plan?: LokeeRevertPlan;
  constructor(
    message: string,
    code: LokeeRevertErrorCode,
    plan?: LokeeRevertPlan
  ) {
    super(message);
    this.name = 'LokeeRevertError';
    this.code = code;
    this.plan = plan;
  }
}

/** Classify a revert to `toVersionId` and preview the reverse DDL. */
export async function planLokeeRevert(
  databaseId: string,
  toVersionId: string,
  /** Plan a revert of only these objects; omit for the whole schema. */
  objectKeys?: readonly string[]
): Promise<LokeeRevertPlan> {
  const params = new URLSearchParams({ toVersionId });
  for (const key of objectKeys ?? []) params.append('objectKeys', key);
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/revert/plan?${params}`,
    { credentials: 'include' }
  );
  return parseJsonResponse<LokeeRevertPlan>(res);
}

export interface LokeeRevertResult extends LokeeRevertPlan {
  ok: true;
  capture?: CaptureResult;
}

/** Apply reverse DDL on the live connection, then capture a new `revert` version. */
export async function executeLokeeRevert(
  databaseId: string,
  body: {
    toVersionId: string;
    connectionId: string;
    password?: string;
    confirmLossy?: boolean;
    /** Revert only these objects; omit for the whole schema. */
    objectKeys?: readonly string[];
  }
): Promise<LokeeRevertResult> {
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/revert`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    }
  );
  const data = await parseJsonBody<
    LokeeRevertPlan & { ok?: boolean; error?: string; code?: string; capture?: CaptureResult }
  >(res);
  if (res.ok) return { ...data, ok: true as const };
  const code =
    data.code === 'blocked' ||
    data.code === 'confirm_lossy' ||
    data.code === 'connection_mismatch' ||
    data.code === 'schema_drifted'
      ? data.code
      : 'failed';
  throw new LokeeRevertError(
    data.error || res.statusText || 'Revert failed',
    code,
    data.fromVersion ? data : undefined
  );
}

/**
 * Diff a version against another (its parent by default).
 *
 * Reads the object store, so this works on a database that is offline or no
 * longer reachable — the whole point of keeping the objects.
 */
export async function compareLokeeVersions(
  databaseId: string,
  versionId: string,
  againstVersionId?: string
): Promise<VersionCompare> {
  const params = new URLSearchParams({ versionId });
  if (againstVersionId) params.set('againstVersionId', againstVersionId);
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/compare?${params}`,
    { credentials: 'include' }
  );
  return parseJsonResponse<VersionCompare>(res);
}

export type { VersionCompare } from '@foxschema/shared';
