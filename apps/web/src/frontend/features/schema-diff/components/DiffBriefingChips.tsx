/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The same + / ~ / − language Sync and Snapshots use. Counts come from a
 * compare DTO or a version delta — never a second schema load.
 */
import React from 'react';
import type { DiffBriefing } from '../lib/diffBriefing';

export function DiffBriefingChips({
  briefing,
  testId = 'diff-briefing',
  showUnchanged = false,
}: {
  briefing: DiffBriefing;
  testId?: string;
  showUnchanged?: boolean;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-1.5 text-[11px] font-bold"
      title="Object-level + / ~ / − — no extra query."
    >
      <span className="text-emerald-400">+{briefing.added}</span>
      <span className="text-amber-400">~{briefing.modified}</span>
      <span className="text-rose-400">−{briefing.removed}</span>
      {showUnchanged && <span className="font-semibold text-slate-500">{briefing.unchanged} unchanged</span>}
    </div>
  );
}

/** Stacked SVG ticks for a version row. Zero-width segments are omitted. */
export function DiffBriefingTicks({
  added,
  modified,
  removed,
}: {
  added: number;
  modified: number;
  removed: number;
}): React.ReactElement {
  const total = Math.max(0, added) + Math.max(0, modified) + Math.max(0, removed);
  if (total <= 0) {
    return (
      <span
        data-testid="lokee-change-ticks"
        className="h-1.5 w-24 shrink-0 rounded bg-slate-800"
        aria-hidden
      />
    );
  }
  const width = 96;
  const height = 6;
  const segs = [
    { n: Math.max(0, added), fill: '#34d399' },
    { n: Math.max(0, modified), fill: '#fbbf24' },
    { n: Math.max(0, removed), fill: '#fb7185' },
  ];
  let x = 0;
  return (
    <svg
      data-testid="lokee-change-ticks"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 rounded"
      aria-hidden
    >
      {segs.map((seg, i) => {
        if (seg.n <= 0) return null;
        const w = Math.max(2, Math.round((seg.n / total) * width));
        const el = (
          <rect key={i} x={x} y={0} width={w} height={height} fill={seg.fill} />
        );
        x += w;
        return el;
      })}
    </svg>
  );
}
