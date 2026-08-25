/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turn a container's per-version growth into rows a reader can scan.
 *
 * A database that has been captured for a while has hundreds of versions, and
 * for any one table nearly all of them are a flat line — the object did not
 * move. Printing one row per version buries the handful of versions that
 * actually changed the table under the ones that did not.
 *
 * So the roadmap keeps only the rows that carry information — the versions
 * that changed this object, the head, and whatever the user is looking at —
 * and folds each run of untouched versions into one row that says how many
 * were skipped and can be opened on demand. Nothing is dropped; the flat parts
 * are just no longer spelled out one version at a time.
 */
import type { ContainerGrowthPoint } from '@foxschema/shared';

export interface RoadmapVersionRow {
  kind: 'version';
  point: ContainerGrowthPoint;
  isHead: boolean;
  isSelected: boolean;
  /**
   * Columns gained or lost since the previous version *in the full history*,
   * not since the previous visible row — the number has to stay true when a
   * gap between the two rows is collapsed.
   */
  columnDelta: number;
}

export interface RoadmapGapRow {
  kind: 'gap';
  /** Stable across re-renders: it is what "this gap is expanded" is keyed on. */
  id: string;
  fromVersion: number;
  toVersion: number;
  count: number;
}

export type RoadmapRow = RoadmapVersionRow | RoadmapGapRow;

export interface RoadmapOptions {
  headVersionId: string | null;
  selectedVersionId: string | null;
  /** Gap ids the user has opened. */
  expandedGaps: ReadonlySet<string>;
  /** Skip the folding entirely. */
  showAll: boolean;
}

/** Rows for one container's roadmap, oldest version first. */
export function buildRoadmapRows(
  growth: readonly ContainerGrowthPoint[],
  { headVersionId, selectedVersionId, expandedGaps, showAll }: RoadmapOptions
): RoadmapRow[] {
  const rows: RoadmapRow[] = [];
  /** The untouched run being accumulated, carrying each point's own index. */
  let pending: Array<{ point: ContainerGrowthPoint; index: number }> = [];

  const gapId = (run: typeof pending): string =>
    `${run[0]!.point.versionNumber}-${run[run.length - 1]!.point.versionNumber}`;

  const versionRow = (point: ContainerGrowthPoint, index: number): RoadmapVersionRow => ({
    kind: 'version',
    point,
    isHead: point.versionId === headVersionId,
    isSelected: point.versionId === selectedVersionId,
    columnDelta: index === 0 ? 0 : point.columns - growth[index - 1]!.columns,
  });

  const flush = () => {
    if (pending.length === 0) return;
    const id = gapId(pending);
    // A one-version gap costs the same row either way, so show the version.
    if (pending.length === 1 || expandedGaps.has(id)) {
      for (const entry of pending) rows.push(versionRow(entry.point, entry.index));
    } else {
      rows.push({
        kind: 'gap',
        id,
        fromVersion: pending[0]!.point.versionNumber,
        toVersion: pending[pending.length - 1]!.point.versionNumber,
        count: pending.length,
      });
    }
    pending = [];
  };

  growth.forEach((point, index) => {
    const keep =
      showAll ||
      point.changed === true ||
      point.versionId === headVersionId ||
      point.versionId === selectedVersionId;
    if (keep) {
      flush();
      rows.push(versionRow(point, index));
    } else {
      pending.push({ point, index });
    }
  });
  flush();
  return rows;
}

/** How many versions the folding is currently hiding, for the header. */
export function hiddenVersionCount(rows: readonly RoadmapRow[]): number {
  return rows.reduce((sum, row) => (row.kind === 'gap' ? sum + row.count : sum), 0);
}
