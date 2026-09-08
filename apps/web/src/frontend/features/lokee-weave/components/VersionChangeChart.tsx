/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stacked + / ~ / − bars for captured versions. Counts already on the
 * timeline DTO — no extra schema load.
 */
import React from 'react';
import type { TimelineVersion } from './VersionTimeline';
import { StatCard } from '@/shared/components/surfaces';

const CHART_H = 180;
const BAR_W = 18;
const GAP = 10;
const PAD_X = 8;
const PAD_Y = 12;

export function VersionChangeChart({
  versions,
}: {
  versions: readonly TimelineVersion[];
}): React.ReactElement {
  const rows = [...versions].slice(0, 16).reverse();
  const max = Math.max(
    1,
    ...rows.map((v) => (v.added ?? 0) + (v.modified ?? 0) + (v.removed ?? 0) || v.changeCount || 0)
  );
  const innerH = CHART_H - PAD_Y * 2 - 18;
  const width = Math.max(160, PAD_X * 2 + rows.length * (BAR_W + GAP) - GAP);

  return (
    <div data-testid="lokee-change-chart" className="shrink-0 border-b border-slate-800 px-6 py-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Change volume
      </p>
      {rows.length === 0 ? (
        <p className="text-[12px] text-slate-500">No versions yet.</p>
      ) : (
        <svg
          width={width}
          height={CHART_H}
          viewBox={`0 0 ${width} ${CHART_H}`}
          className="max-w-full"
          role="img"
          aria-label="Stacked added, modified, and removed counts per version"
        >
          {rows.map((v, i) => {
            const added = v.added ?? 0;
            const modified = v.modified ?? 0;
            const removed = v.removed ?? 0;
            const total = added + modified + removed || v.changeCount || 0;
            const x = PAD_X + i * (BAR_W + GAP);
            const h = Math.max(total > 0 ? 4 : 0, Math.round((total / max) * innerH));
            const yBase = PAD_Y + innerH;
            const hAdd = total ? (added / total) * h : 0;
            const hMod = total ? (modified / total) * h : 0;
            const hRem = total ? (removed / total) * h : 0;
            let y = yBase - h;
            return (
              <g key={v.id}>
                {hAdd > 0 && (
                  <rect x={x} y={y} width={BAR_W} height={hAdd} fill="#34d399" rx={1} />
                )}
                {hAdd > 0 && (y += hAdd)}
                {hMod > 0 && (
                  <rect x={x} y={y} width={BAR_W} height={hMod} fill="#fbbf24" rx={1} />
                )}
                {hMod > 0 && (y += hMod)}
                {hRem > 0 && (
                  <rect x={x} y={y} width={BAR_W} height={hRem} fill="#fb7185" rx={1} />
                )}
                <text
                  x={x + BAR_W / 2}
                  y={CHART_H - 4}
                  textAnchor="middle"
                  className="fill-slate-500"
                  fontSize="9"
                >
                  v{v.number}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function VersionBriefing({
  versions,
  selectedId,
}: {
  versions: readonly TimelineVersion[];
  selectedId?: string | null;
}): React.ReactElement {
  const selected =
    versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;
  if (!selected) {
    return (
      <div className="shrink-0 border-b border-slate-800 px-6 py-2 text-[12px] text-slate-500" data-testid="lokee-version-briefing">
        Select a version in the timeline.
      </div>
    );
  }
  const added = selected.added ?? 0;
  const modified = selected.modified ?? 0;
  const removed = selected.removed ?? 0;
  return (
    <div
      className="shrink-0 border-b border-slate-800 px-6 py-3"
      data-testid="lokee-version-briefing"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-bold text-slate-100">v{selected.number}</span>
        <span className="truncate text-[11px] text-slate-400">
          {selected.name || selected.source || 'Snapshot'}
        </span>
      </div>
      {/* Counts as cards, not a run-on of coloured numbers: the sign alone
          ("+3 ~2 −0") makes the reader supply the nouns. */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard testId="lokee-briefing-added" label="Added" tone="positive" value={`+${added}`} />
        <StatCard
          testId="lokee-briefing-modified"
          label="Modified"
          tone="warning"
          value={`~${modified}`}
        />
        <StatCard
          testId="lokee-briefing-removed"
          label="Removed"
          tone="danger"
          value={`−${removed}`}
        />
      </div>
    </div>
  );
}
