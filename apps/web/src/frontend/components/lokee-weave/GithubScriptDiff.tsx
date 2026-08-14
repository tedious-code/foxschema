/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified GitHub-style diff for a Lokee object script (CREATE TABLE / routine).
 */
import React from 'react';
import { diffLines } from '../../utils/lineDiff';

export function GithubScriptDiff({
  original,
  modified,
}: {
  original: string;
  modified: string;
}): React.ReactElement {
  const lines = diffLines(original, modified);
  const added = lines.filter((l) => l.type === 'added').length;
  const removed = lines.filter((l) => l.type === 'removed').length;
  return (
    <div data-testid="lokee-inspector-script-diff" className="overflow-hidden rounded border border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-400">
        <span>Script</span>
        <span>
          <span className="text-emerald-400">+{added}</span>
          <span className="mx-1 text-slate-600">/</span>
          <span className="text-rose-400">−{removed}</span>
        </span>
      </div>
      <pre className="max-h-56 overflow-auto bg-slate-950 font-mono text-[10px] leading-4">
        {lines.map((line, i) => {
          const cls =
            line.type === 'added'
              ? 'bg-emerald-500/15 text-emerald-200'
              : line.type === 'removed'
                ? 'bg-rose-500/15 text-rose-300'
                : 'text-slate-400';
          const mark = line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' ';
          return (
            <div key={`${i}:${line.type}:${line.text}`} className={`flex gap-2 px-2 py-px ${cls}`}>
              <span className="w-3 shrink-0 select-none text-center opacity-70">{mark}</span>
              <span className="min-w-0 whitespace-pre-wrap break-all">{line.text || ' '}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
