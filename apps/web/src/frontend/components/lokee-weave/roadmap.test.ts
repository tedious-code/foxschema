/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The rule these encode: fold only what carries no information, and never
 * fold away the version the reader is standing on.
 */
import { describe, expect, it } from 'vitest';
import type { ContainerGrowthPoint } from '../../../shared/lokee-wire';
import { buildRoadmapRows, hiddenVersionCount } from './roadmap';

const point = (n: number, columns: number, changed: boolean): ContainerGrowthPoint => ({
  versionId: `v${n}`,
  versionNumber: n,
  createdAt: `2026-08-${String(n).padStart(2, '0')}T00:00:00.000Z`,
  columns,
  indexes: 0,
  foreignKeys: 0,
  triggers: 0,
  objects: columns + 1,
  changed,
});

/** v1 creates it, v10 adds a column, v15 is head — everything else is flat. */
const HISTORY: ContainerGrowthPoint[] = Array.from({ length: 15 }, (_, i) => {
  const n = i + 1;
  return point(n, n < 10 ? 3 : 4, n === 1 || n === 10);
});

const build = (over: Partial<Parameters<typeof buildRoadmapRows>[1]> = {}) =>
  buildRoadmapRows(HISTORY, {
    headVersionId: 'v15',
    selectedVersionId: 'v15',
    expandedGaps: new Set<string>(),
    showAll: false,
    ...over,
  });

const numberOf = (row: ReturnType<typeof build>[number]): number =>
  row.kind === 'version' ? row.point.versionNumber : -1;

describe('buildRoadmapRows', () => {
  it('keeps the versions that changed the object and folds the rest', () => {
    const rows = build();
    expect(rows.map((r) => (r.kind === 'gap' ? `gap:${r.id}` : `v${r.point.versionNumber}`))).toEqual([
      'v1',
      'gap:2-9',
      'v10',
      'gap:11-14',
      'v15',
    ]);
    expect(hiddenVersionCount(rows)).toBe(12);
  });

  it('always shows the head and whatever version is being viewed', () => {
    const rows = build({ selectedVersionId: 'v7' });
    expect(rows.map(numberOf)).toContain(7);
    expect(rows.find((r) => numberOf(r) === 7)).toMatchObject({ isSelected: true, isHead: false });
    expect(rows.find((r) => numberOf(r) === 15)).toMatchObject({ isHead: true });
  });

  it('measures the column delta against the real previous version, not the previous row', () => {
    // v10 follows a folded run. Its "+1" has to be against v9, or the number
    // would change depending on what happens to be visible.
    expect(build().find((r) => numberOf(r) === 10)).toMatchObject({ columnDelta: 1 });
    // The first point has nothing to compare against.
    expect(build().find((r) => numberOf(r) === 1)).toMatchObject({ columnDelta: 0 });
  });

  it('expands one gap without touching the others', () => {
    const rows = build({ expandedGaps: new Set(['2-9']) });
    expect(rows.filter((r) => r.kind === 'version')).toHaveLength(11);
    expect(rows.filter((r) => r.kind === 'gap').map((r) => (r.kind === 'gap' ? r.id : ''))).toEqual([
      '11-14',
    ]);
  });

  it('shows everything under showAll', () => {
    const rows = build({ showAll: true });
    expect(rows).toHaveLength(15);
    expect(hiddenVersionCount(rows)).toBe(0);
  });

  it('does not fold a single version — the row costs the same either way', () => {
    const rows = buildRoadmapRows([point(1, 1, true), point(2, 1, false), point(3, 1, true)], {
      headVersionId: 'v3',
      selectedVersionId: 'v3',
      expandedGaps: new Set<string>(),
      showAll: false,
    });
    expect(rows.every((r) => r.kind === 'version')).toBe(true);
  });

  it('handles an empty history', () => {
    expect(
      buildRoadmapRows([], {
        headVersionId: null,
        selectedVersionId: null,
        expandedGaps: new Set<string>(),
        showAll: false,
      })
    ).toEqual([]);
  });

  it('folds a history where nothing ever changed, keeping only head', () => {
    const flat = Array.from({ length: 6 }, (_, i) => point(i + 1, 2, false));
    const rows = buildRoadmapRows(flat, {
      headVersionId: 'v6',
      selectedVersionId: 'v6',
      expandedGaps: new Set<string>(),
      showAll: false,
    });
    expect(rows.map((r) => r.kind)).toEqual(['gap', 'version']);
    expect(hiddenVersionCount(rows)).toBe(5);
  });
});
