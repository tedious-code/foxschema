/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Default Snapshots workspace: a version list from GET /versions, not the
 * React Flow graph (that reconstructs object nodes and is opt-in).
 */
import React from 'react';
import type { VersionGraphVersion } from '@foxschema/shared';

export interface VersionTimelineProps {
  versions: readonly (VersionGraphVersion & { changeCount?: number })[];
  totalVersions: number;
  selectedId?: string | null;
  subtitle?: string;
  onSelect?: (versionId: string) => void;
}

function barWidth(changeCount: number, max: number): string {
  if (max <= 0 || changeCount <= 0) return '0%';
  return `${Math.max(4, Math.round((changeCount / max) * 100))}%`;
}

export function VersionTimeline({
  versions,
  totalVersions,
  selectedId,
  subtitle,
  onSelect,
}: VersionTimelineProps): React.ReactElement {
  const maxChanges = Math.max(0, ...versions.map((v) => v.changeCount ?? 0));
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-2" data-testid="lokee-timeline">
      <header
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400"
        data-testid="lokee-summary"
      >
        <span className="font-semibold text-slate-300">Schema history</span>
        <span className="text-slate-600">·</span>
        <span>
          <span className="font-bold text-slate-100">{totalVersions}</span> versions
        </span>
        {subtitle && <span className="truncate text-slate-600">{subtitle}</span>}
      </header>
      <ol className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pb-4">
        {versions.map((version) => {
          const selected = version.id === selectedId;
          return (
            <li key={version.id}>
              <button
                type="button"
                data-testid={`lokee-timeline-v-${version.number}`}
                onClick={() => onSelect?.(version.id)}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition ${
                  selected
                    ? 'border-cyan-500/40 bg-cyan-950/30'
                    : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                }`}
              >
                <span className="w-16 shrink-0 text-xs font-bold text-slate-200">
                  v{version.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                  {version.name || version.source}
                  {(version.changeCount ?? 0) > 0 ? ` · ${version.changeCount} changes` : ''}
                </span>
                <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded bg-slate-800">
                  <span
                    className="block h-full rounded bg-cyan-500/80"
                    style={{ width: barWidth(version.changeCount ?? 0, maxChanges) }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
