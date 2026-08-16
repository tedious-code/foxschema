/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * History reuses Compare's Original → Target model:
 *   Original = a captured version (the baseline)
 *   Target   = the current database (latest snapshot) or an older version
 */

export interface HistoryVersionOption {
  id: string;
  number: number;
  name?: string;
}

export interface HistoryCompareSelection {
  /** Null means "previous version" (or the only version). */
  originalVersionId: string | null;
  /** Null means "current database" — the latest captured version. */
  targetVersionId: string | null;
}

export interface ResolvedHistoryCompare {
  original: HistoryVersionOption | null;
  target: HistoryVersionOption | null;
  targetIsCurrent: boolean;
  latest: HistoryVersionOption | null;
  previous: HistoryVersionOption | null;
}

export function sortVersionsNewestFirst<T extends { number: number }>(versions: readonly T[]): T[] {
  return [...versions].sort((a, b) => b.number - a.number);
}

export function resolveHistoryCompare(
  versions: readonly HistoryVersionOption[],
  selection: HistoryCompareSelection
): ResolvedHistoryCompare {
  const newestFirst = sortVersionsNewestFirst(versions);
  const latest = newestFirst[0] ?? null;
  const previous = newestFirst[1] ?? latest;
  const original =
    (selection.originalVersionId
      ? newestFirst.find((v) => v.id === selection.originalVersionId)
      : undefined) ??
    previous ??
    null;
  const targetExplicit = selection.targetVersionId
    ? newestFirst.find((v) => v.id === selection.targetVersionId)
    : undefined;
  const target = targetExplicit ?? latest;
  const targetIsCurrent = selection.targetVersionId == null || target?.id === latest?.id;
  return { original, target, targetIsCurrent, latest, previous };
}

/** Swap Original ↔ Target, keeping "current database" when the new target is latest. */
export function swapHistoryCompare(
  versions: readonly HistoryVersionOption[],
  selection: HistoryCompareSelection
): HistoryCompareSelection {
  const resolved = resolveHistoryCompare(versions, selection);
  if (!resolved.original || !resolved.target) return selection;
  if (resolved.original.id === resolved.target.id) return selection;
  const latestId = resolved.latest?.id;
  return {
    originalVersionId: resolved.target.id,
    targetVersionId: resolved.original.id === latestId ? null : resolved.original.id,
  };
}

export function historyVersionLabel(
  version: HistoryVersionOption,
  opts?: { current?: boolean }
): string {
  const custom = version.name?.trim();
  const base = custom ? `v${version.number} · ${custom}` : `Version ${version.number}`;
  return opts?.current ? `Current database (${base})` : base;
}

export function lokeeDatabaseLabel(database: {
  id: string;
  dialect: string;
  host?: string;
  database?: string;
  schema?: string;
  versionCount?: number;
}): string {
  const where =
    [database.host, database.database].filter(Boolean).join('/') || database.id.slice(0, 8);
  const schema = database.schema ? ` · ${database.schema}` : '';
  const versions =
    typeof database.versionCount === 'number' ? ` (${database.versionCount} v)` : '';
  return `${database.dialect.toUpperCase()} · ${where}${schema}${versions}`;
}
