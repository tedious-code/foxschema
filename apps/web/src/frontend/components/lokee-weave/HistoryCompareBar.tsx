/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * History toolbar — same Original → Target cards as Compare, but the sides
 * are versions of one captured database instead of two live connections.
 */
import React, { useMemo } from 'react';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { useLokeeHistoryStore } from '../../store/lokeeHistoryStore';
import {
  historyVersionLabel,
  lokeeDatabaseLabel,
  resolveHistoryCompare,
  sortVersionsNewestFirst,
} from '../../lib/historyCompare';

export function HistoryCompareBar(): React.ReactElement {
  const databases = useLokeeHistoryStore((s) => s.databases);
  const versions = useLokeeHistoryStore((s) => s.versions);
  const databaseId = useLokeeHistoryStore((s) => s.databaseId);
  const originalVersionId = useLokeeHistoryStore((s) => s.originalVersionId);
  const targetVersionId = useLokeeHistoryStore((s) => s.targetVersionId);
  const setDatabaseId = useLokeeHistoryStore((s) => s.setDatabaseId);
  const setOriginalVersionId = useLokeeHistoryStore((s) => s.setOriginalVersionId);
  const setTargetVersionId = useLokeeHistoryStore((s) => s.setTargetVersionId);
  const swapSides = useLokeeHistoryStore((s) => s.swapSides);

  const newestFirst = useMemo(() => sortVersionsNewestFirst(versions), [versions]);
  const resolved = useMemo(
    () => resolveHistoryCompare(versions, { originalVersionId, targetVersionId }),
    [versions, originalVersionId, targetVersionId]
  );
  const olderTargets = newestFirst.filter((v) => v.id !== resolved.latest?.id);
  const sameSides =
    Boolean(resolved.original && resolved.target && resolved.original.id === resolved.target.id);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-11 gap-2 items-stretch" data-testid="lokee-history-compare-bar">
      <div className="xl:col-span-5 bg-slate-950/60 p-2 rounded-md border border-slate-800/80 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-500/80">
            Original
          </div>
          <div className="text-[10px] text-slate-500">Select a version</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            data-testid="lokee-database-select"
            value={databaseId ?? ''}
            disabled={databases.length === 0}
            onChange={(e) => setDatabaseId(e.target.value || null)}
            title="History database"
            className="min-w-0 flex-1 text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 truncate disabled:opacity-50"
          >
            {databases.length === 0 && <option value="">No captures yet</option>}
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {lokeeDatabaseLabel(d)}
              </option>
            ))}
          </select>
          <select
            data-testid="lokee-original-version"
            value={resolved.original?.id ?? ''}
            disabled={newestFirst.length === 0}
            onChange={(e) => setOriginalVersionId(e.target.value || null)}
            title="Baseline version (like Compare's Original Server)"
            className="min-w-0 w-44 max-w-full text-xs bg-slate-900 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100 focus:outline-none focus:border-cyan-500 truncate disabled:opacity-50"
          >
            {newestFirst.length === 0 && <option value="">No versions</option>}
            {newestFirst.map((v) => (
              <option key={v.id} value={v.id}>
                {historyVersionLabel(v)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex xl:col-span-1 justify-center items-center">
        <button
          type="button"
          data-testid="lokee-history-swap-btn"
          onClick={swapSides}
          disabled={sameSides || newestFirst.length < 2}
          title="Swap Original and Target"
          className="group flex flex-col items-center gap-0.5 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="text-[9px] font-bold uppercase tracking-wider text-cyan-500/70 group-hover:text-cyan-400">
            Original
          </span>
          <ArrowRight className="w-5 h-5 text-indigo-500/80 group-hover:hidden transition" />
          <ArrowLeftRight className="w-5 h-5 text-cyan-400 hidden group-hover:block" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400/70 group-hover:text-cyan-400">
            Target
          </span>
        </button>
      </div>

      <div className="xl:col-span-5 bg-slate-950/60 p-2 rounded-md border border-slate-800/80 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400/80">
            Target
          </div>
          <div className="text-[10px] text-slate-500">Current database or older version</div>
        </div>
        <select
          data-testid="lokee-target-version"
          value={resolved.targetIsCurrent ? '' : (resolved.target?.id ?? '')}
          disabled={newestFirst.length === 0}
          onChange={(e) => setTargetVersionId(e.target.value || null)}
          title="Current live snapshot, or an older version"
          className="w-full text-xs bg-slate-900 border border-purple-500/30 rounded px-2 py-1 text-purple-100 focus:outline-none focus:border-purple-500 truncate disabled:opacity-50"
        >
          {resolved.latest ? (
            <option value="">{historyVersionLabel(resolved.latest, { current: true })}</option>
          ) : (
            <option value="">Current database</option>
          )}
          {olderTargets.map((v) => (
            <option key={v.id} value={v.id}>
              {historyVersionLabel(v)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
