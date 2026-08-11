/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave graph — the DTO the view is built from.
 *
 * Deliberately not the storage shape. The graph must not know how history is
 * persisted (object store, deltas, checkpoints); it renders a flat list of
 * versions and per-version object positions, and a backend service is free to
 * reconstruct that however it likes.
 */
import type { LokeeObjectType } from '@foxschema/sql';

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
}

export interface VersionGraphObject {
  versionId: string;
  /** Logical identity — never the hash. A rename is a delete plus an add. */
  objectKey: string;
  name: string;
  schemaName?: string;
  objectType: LokeeObjectType;
  /** Content identity. Null for a tombstone. */
  objectHash: string | null;
  status: GraphChangeStatus;
}

export interface VersionGraphDTO {
  databaseId: string;
  versions: VersionGraphVersion[];
  objects: VersionGraphObject[];
  /** Totals for the whole history, not just the returned window. */
  totalVersions: number;
  totalObjects: number;
}

export type VersionEdgeStatus = 'created' | 'reused' | 'modified' | 'deleted';

export interface VersionGraphFilters {
  /** Empty means "every type". */
  objectTypes: Set<LokeeObjectType>;
  statuses: Set<GraphChangeStatus>;
  /** Empty means every version. */
  versionIds: Set<string>;
  /** Empty means every author. Matches resolved email / id. */
  authors: Set<string>;
  /** Inclusive YYYY-MM-DD; empty means no lower bound. */
  dateFrom: string;
  /** Inclusive YYYY-MM-DD; empty means no upper bound. */
  dateTo: string;
  /** Hide unchanged objects — the "changes only" view. */
  changesOnly: boolean;
  showDeleted: boolean;
}

export const EMPTY_FILTERS: VersionGraphFilters = {
  objectTypes: new Set(),
  statuses: new Set(),
  versionIds: new Set(),
  authors: new Set(),
  dateFrom: '',
  dateTo: '',
  changesOnly: false,
  showDeleted: true,
};

/** Node payloads. Kept small — the inspector loads detail on demand. */
export interface VersionNodeData extends Record<string, unknown> {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  rootHash: string;
  author?: string;
  name?: string;
  description?: string;
  changeCount: number;
}

/** Prefer a custom label; otherwise "Version N". */
export function versionDisplayName(
  version: Pick<VersionGraphVersion, 'number' | 'name'> | Pick<VersionNodeData, 'versionNumber' | 'name'>
): string {
  const custom =
    'name' in version && typeof version.name === 'string' ? version.name.trim() : '';
  if (custom) return custom;
  const n = 'versionNumber' in version ? version.versionNumber : version.number;
  return `Version ${n}`;
}

export interface SchemaObjectNodeData extends Record<string, unknown> {
  versionId: string;
  objectKey: string;
  name: string;
  objectType: LokeeObjectType;
  objectHash: string | null;
  status: GraphChangeStatus;
  previousHash: string | null;
}

export interface LokeeEdgeData extends Record<string, unknown> {
  status: VersionEdgeStatus;
  objectKey?: string;
  previousHash?: string | null;
  currentHash?: string | null;
}

/**
 * Layout constants. Versions run down the Y axis, one logical object per
 * X column, so an object keeps the same column for its whole life and the eye
 * can follow it without tracking a moving target.
 */
export interface GraphLayout {
  versionX: number;
  objectStartX: number;
  objectColumnWidth: number;
  versionRowHeight: number;
}

export const DEFAULT_LAYOUT: GraphLayout = {
  versionX: 40,
  objectStartX: 270,
  objectColumnWidth: 170,
  versionRowHeight: 150,
};

/**
 * Ceiling on rendered object nodes.
 *
 * A 20,000-object schema across 5 versions is 100,000 nodes; React Flow will
 * not survive that and neither will the reader. When the cap bites, changed
 * objects are kept and the view says so rather than truncating silently.
 */
export const MAX_VISIBLE_OBJECT_NODES = 500;

/** Short hash for a node face. The full hash belongs in the inspector. */
export function shortHash(hash: string | null | undefined): string {
  return typeof hash === 'string' && hash.length > 0 ? hash.slice(0, 6).toUpperCase() : '—';
}
