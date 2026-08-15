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
import type { ConnectionRef } from './schemaApi';
import type { VersionGraphDTO } from '../components/lokee-weave/graphTypes';
import { getApiBase, parseJsonBody, parseJsonResponse } from './apiBase';

export interface LokeeDatabase {
  id: string;
  dialect: string;
  host?: string;
  database?: string;
  schema?: string;
  versionCount: number;
  lastSeenAt: string;
}

export interface LokeeVersion {
  id: string;
  number: number;
  rootHash: string;
  createdAt: string;
  lastObservedAt: string;
  observationCount: number;
  source: string;
  migrationRunId?: string;
  authorUserId?: string;
  /** Resolved email for attribution / filters. */
  author?: string;
  /** Optional display name; omit to show "Version N". */
  name?: string;
  description?: string;
  objectCount: number;
  changeCount: number;
}

export interface CaptureResult {
  databaseId: string;
  versionId: string;
  versionNumber: number;
  rootHash: string;
  changed: boolean;
  changeCount: number;
  objectCount: number;
}

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
): Promise<VersionGraphDTO & { truncatedObjects: boolean }> {
  const res = await fetch(
    `${getApiBase()}/lokee/databases/${encodeURIComponent(databaseId)}/graph?limit=${limit}`,
    { credentials: 'include' }
  );
  return parseJsonResponse<VersionGraphDTO & { truncatedObjects: boolean }>(res);
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

export interface LokeeHistoryEvent {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  source: string;
  operation: 'ADD' | 'MODIFY' | 'DELETE';
  hash?: string;
  previousHash?: string;
  body?: Record<string, unknown>;
  previousBody?: Record<string, unknown>;
  lineCount?: number | null;
  previousLineCount?: number | null;
  firstSeenAt?: string | null;
  reused: boolean;
}

export interface LokeeInspectResult {
  blueprint: {
    focusKey: string;
    container: LokeeStoredObject | null;
    object: LokeeStoredObject | null;
    columns: LokeeStoredObject[];
    indexes: LokeeStoredObject[];
    foreignKeys: LokeeStoredObject[];
    triggers: LokeeStoredObject[];
    primaryKey: LokeeStoredObject | null;
  };
  history: LokeeHistoryEvent[];
  growth: Array<{
    versionId: string;
    versionNumber: number;
    createdAt: string;
    columns: number;
    indexes: number;
    foreignKeys: number;
    triggers: number;
    objects: number;
  }>;
  columnMutations: Array<{
    objectKey: string;
    columnName: string;
    events: LokeeHistoryEvent[];
  }>;
  script?: string;
  previousScript?: string;
}

export interface LokeeStoredObject {
  key: string;
  type: string;
  name: string;
  hash: string;
  body: Record<string, unknown>;
  sourceText?: string | null;
  lineCount?: number | null;
  firstSeenAt?: string | null;
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

export interface LokeeRevertPlan {
  fromVersion: LokeeVersion;
  toVersion: LokeeVersion;
  alreadyAtTarget: boolean;
  reversal: {
    verdicts: Array<{ key: string; risk: 'safe' | 'lossy' | 'blocked'; summary: string; dataLoss?: string }>;
    risk: 'safe' | 'lossy' | 'blocked';
    safeCount: number;
    lossyCount: number;
    blockedCount: number;
  };
  statements: string[];
}

export class LokeeRevertError extends Error {
  readonly code: 'blocked' | 'confirm_lossy' | 'connection_mismatch' | 'failed';
  readonly plan?: LokeeRevertPlan;
  constructor(
    message: string,
    code: 'blocked' | 'confirm_lossy' | 'connection_mismatch' | 'failed',
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
  toVersionId: string
): Promise<LokeeRevertPlan> {
  const params = new URLSearchParams({ toVersionId });
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
    data.code === 'connection_mismatch'
      ? data.code
      : 'failed';
  throw new LokeeRevertError(
    data.error || res.statusText || 'Revert failed',
    code,
    data.fromVersion ? data : undefined
  );
}
