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
import type { Edge, Node } from '@xyflow/react';
import type { LokeeObjectType, ObjectChangeKind } from '@foxschema/sql';
import type {
  GraphChangeStatus,
  VersionGraphObject,
  VersionGraphVersion,
} from '../../../shared/lokee-wire';

// The wire contract lives in src/shared so the backend that produces it and
// this view that renders it are checked against one declaration. Re-exported
// here so component imports stay pointed at this module.
export type {
  GraphChangeStatus,
  VersionGraphDTO,
  VersionGraphObject,
  VersionGraphVersion,
} from '../../../shared/lokee-wire';

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

/** Default History sidebar: containers that people actually revert, plus changes-only. */
export const DEFAULT_HISTORY_OBJECT_TYPES: readonly LokeeObjectType[] = [
  'table',
  'view',
  'function',
  'procedure',
];

/** Node payloads. Kept small — the inspector loads detail on demand. */
export type VersionNodeData = {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  rootHash: string;
  author?: string;
  name?: string;
  description?: string;
  changeCount: number;
  /** Version this one restored, when a revert produced it. */
  revertedToNumber?: number;
};

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

export type SchemaObjectNodeData = {
  versionId: string;
  objectKey: string;
  name: string;
  objectType: LokeeObjectType;
  objectHash: string | null;
  status: GraphChangeStatus;
  previousHash: string | null;
  /** Kinds of child change on a container; absent on children and on leaves. */
  changeKinds?: ObjectChangeKind[];
};

export type LokeeEdgeData = {
  status: VersionEdgeStatus;
  objectKey?: string;
  previousHash?: string | null;
  currentHash?: string | null;
};

/**
 * React Flow node/edge types carrying their own payload.
 *
 * `NodeProps<LokeeVersionNode>` gives a renderer a typed `data` — without
 * these, `data` arrives as `Record<string, unknown>` and every renderer casts
 * it back, which also lets a `node.type` check and its cast disagree.
 */
export type LokeeVersionNode = Node<VersionNodeData, 'versionNode'>;
export type LokeeObjectNode = Node<SchemaObjectNodeData, 'schemaObjectNode' | 'deletedObjectNode'>;
export type LokeeNode = LokeeVersionNode | LokeeObjectNode;
export type LokeeEdge = Edge<LokeeEdgeData>;

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
  /** Nudge object cards down so they sit beside the version title, not the top edge. */
  objectYOffset: number;
}

export const DEFAULT_LAYOUT: GraphLayout = {
  versionX: 40,
  objectStartX: 270,
  objectColumnWidth: 170,
  versionRowHeight: 150,
  objectYOffset: 16,
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
