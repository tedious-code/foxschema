/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified GitHub-style diff for a Lokee object script (CREATE TABLE / routine).
 *
 * The inline pane is deliberately short — it sits inside a detail column next
 * to everything else about the object. A view or a routine body is routinely
 * longer than that, so the header carries a maximize button that reopens the
 * same diff full screen. Both call sites (the object inspector and the version
 * compare modal) get it from here rather than each growing its own copy.
 */
import React from 'react';
import { Maximize2, X } from 'lucide-react';
import { diffLines } from '@/shared/utils/lineDiff';

/** One rendered diff line — shared by the inline pane and the maximized one. */
function DiffLine({ line }: { line: { type: string; text: string } }): React.ReactElement {
  const cls =
    line.type === 'added'
      ? 'bg-emerald-500/15 text-emerald-200'
      : line.type === 'removed'
        ? 'bg-rose-500/15 text-rose-300'
        : 'text-slate-400';
  const mark = line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' ';
  return (
    <div className={`flex gap-2 px-2 py-px ${cls}`}>
      <span className="w-3 shrink-0 select-none text-center opacity-70">{mark}</span>
      <span className="min-w-0 whitespace-pre-wrap break-all">{line.text || ' '}</span>
    </div>
  );
}

export function GithubScriptDiff({
  original,
  modified,
  title = 'Script',
}: {
  original: string;
  modified: string;
  /** Shown in the header and as the maximized dialog's heading. */
  title?: string;
}): React.ReactElement {
  const [maximized, setMaximized] = React.useState(false);
  const lines = diffLines(original, modified);
  const added = lines.filter((l) => l.type === 'added').length;
  const removed = lines.filter((l) => l.type === 'removed').length;

  // Escape closes it, like every other dialog here.
  React.useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setMaximized(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [maximized]);

  const counts = (
    <span>
      <span className="text-emerald-400">+{added}</span>
      <span className="mx-1 text-slate-600">/</span>
      <span className="text-rose-400">−{removed}</span>
    </span>
  );

  return (
    <>
      <div
        data-testid="lokee-inspector-script-diff"
        className="overflow-hidden rounded border border-slate-800"
      >
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-400">
          <span>{title}</span>
          <span className="flex items-center gap-2">
            {counts}
            <button
              type="button"
              data-testid="lokee-script-maximize"
              onClick={() => setMaximized(true)}
              title="Open full screen"
              aria-label="Open script full screen"
              className="rounded p-0.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </span>
        </div>
        <pre className="max-h-56 overflow-auto bg-slate-950 font-mono text-[10px] leading-4">
          {lines.map((line, i) => (
            <DiffLine key={`${i}:${line.type}:${line.text}`} line={line} />
          ))}
        </pre>
      </div>

      {maximized && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} full screen`}
          data-testid="lokee-script-modal"
          onClick={() => setMaximized(false)}
        >
          <div
            className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
            // The backdrop closes; a click on the script itself must not.
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
              <span className="font-semibold">{title}</span>
              <span className="flex items-center gap-3 text-[11px]">
                {counts}
                <button
                  type="button"
                  data-testid="lokee-script-modal-close"
                  onClick={() => setMaximized(false)}
                  title="Close (Esc)"
                  aria-label="Close full screen script"
                  className="rounded p-0.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto bg-slate-950 font-mono text-xs leading-5">
              {lines.map((line, i) => (
                <DiffLine key={`${i}:${line.type}:${line.text}`} line={line} />
              ))}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
