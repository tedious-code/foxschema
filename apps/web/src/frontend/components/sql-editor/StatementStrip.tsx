import React, { useCallback, useEffect, useState } from 'react';
import {
  checkStatement,
  dmlLacksWhere,
  isMutatingDmlStatement,
  statementVerb,
  type SplitStatement,
} from '../../lib/sql-splitter';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';

interface Props {
  statements: SplitStatement[];
  checked: number[];
  onToggle: (index: number) => void;
  onReveal: (stmt: SplitStatement) => void;
}

const STORAGE_KEY = 'foxschema-sql-statement-strip-h';
const ROW_PX = 26;
const PAD_PX = 14;
const MIN_ROWS = 1;
const MAX_ROWS = 12;
const DEFAULT_ROWS = 2;

const defaultHeight = () => ROW_PX * DEFAULT_ROWS + PAD_PX;
const minHeight = () => ROW_PX * MIN_ROWS + PAD_PX;
const maxHeight = () => ROW_PX * MAX_ROWS + PAD_PX;

function loadHeight(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(n) && n >= minHeight()) {
      return Math.min(maxHeight(), n);
    }
  } catch {
    /* ignore */
  }
  return defaultHeight();
}

const preview = (text: string, max = 120): string => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? compact.slice(0, max) + '…' : compact;
};

const DML_BADGE: Record<string, string> = {
  update: 'UPD',
  delete: 'DEL',
  merge: 'MRG',
};

/**
 * Per-statement run strip between the editor and results. Resizable; defaults
 * to ~2 statement rows. Safe mode badges UPDATE / DELETE / MERGE.
 */
export const StatementStrip: React.FC<Props> = ({ statements, checked, onToggle, onReveal }) => {
  const [height, setHeight] = useState(loadHeight);
  const safeMode = useSqlEditorStore((s) => s.safeMode);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(height));
    } catch {
      /* ignore */
    }
  }, [height]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      const onMove = (ev: MouseEvent) => {
        const next = Math.min(maxHeight(), Math.max(minHeight(), startH + (ev.clientY - startY)));
        setHeight(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height]
  );

  if (statements.length === 0) return null;

  return (
    <div className="shrink-0 flex flex-col border-b border-slate-800 bg-slate-925/50" data-testid="sql-statement-strip">
      <div className="px-3 py-1.5 flex flex-col gap-0.5 overflow-y-auto" style={{ height }}>
        {statements.map((stmt, i) => {
          const status = checkStatement(stmt);
          const ok = status.level === 'ok';
          const isChecked = checked.includes(i);
          const verb = statementVerb(stmt.text);
          const dmlBadge =
            safeMode && verb && isMutatingDmlStatement(stmt.text) ? DML_BADGE[verb] : null;
          const noWhere = dmlBadge ? dmlLacksWhere(stmt.text) : false;
          return (
            <div
              key={`${stmt.start}-${stmt.end}`}
              className="flex items-start gap-2 text-[11px] text-slate-300 hover:bg-slate-900/40 rounded px-1 py-0.5 group min-h-[1.5rem]"
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(i)}
                className="w-3 h-3 accent-cyan-500 cursor-pointer shrink-0 mt-0.5"
                title={
                  checked.length === 0
                    ? 'None checked → Run uses the first statement'
                    : 'Include this statement when running'
                }
                aria-label={`Statement ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => onReveal(stmt)}
                className="flex-1 flex items-start gap-1.5 min-w-0 text-left cursor-pointer"
                title="Reveal in editor"
              >
                <span className="text-slate-500 font-mono shrink-0">#{i + 1}</span>
                <span
                  className={`shrink-0 font-bold ${ok ? 'text-emerald-400' : 'text-amber-400'}`}
                  title={ok ? 'Looks complete' : status.reasons.join(' · ')}
                >
                  {ok ? '✓' : '⚠'}
                </span>
                {dmlBadge && (
                  <span
                    className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded mt-0.5 ${
                      noWhere
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    }`}
                    title={
                      noWhere
                        ? `${dmlBadge}: no WHERE — may affect all rows`
                        : `Safe mode: ${dmlBadge} requires confirmation on Run`
                    }
                  >
                    {dmlBadge}
                    {noWhere ? '!' : ''}
                  </span>
                )}
                <span className="font-mono text-slate-400 group-hover:text-slate-200 line-clamp-2 break-all">
                  {preview(stmt.text)}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize statement list"
        data-testid="sql-statement-strip-resize"
        title="Drag to resize statement list"
        onMouseDown={startResize}
        className="h-1.5 shrink-0 cursor-row-resize bg-slate-900/80 hover:bg-cyan-500/40 active:bg-cyan-500/60 transition-colors"
      />
    </div>
  );
};
