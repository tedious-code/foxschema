import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import {
  checkStatement,
  dmlLacksWhere,
  isMutatingDmlStatement,
  statementVerb,
  type SplitStatement,
} from '../../lib/sql-splitter';
import { findVariableRefs, substituteVariables } from '../../lib/sql-variables';
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

function resolveSql(
  stmtText: string,
  variables: ReturnType<typeof useSqlEditorStore.getState>['variables']
): { sql: string; error?: string; hasVars: boolean } {
  const hasVars = findVariableRefs(stmtText).length > 0;
  if (!hasVars) return { sql: stmtText, hasVars: false };
  const expanded = substituteVariables(stmtText, variables, { maskSecrets: true });
  if (!expanded.ok) return { sql: stmtText, error: expanded.error, hasVars: true };
  return { sql: expanded.sql, hasVars: true };
}

type PopoverState = {
  index: number;
  top: number;
  left: number;
  width: number;
  sql: string;
  error?: string;
  hasVars: boolean;
};

/**
 * Per-statement run strip. Hover opens a pinned-style preview of query-with-values
 * (overlaps the row so the pointer can reach Copy). Each row also has its own Copy.
 */
export const StatementStrip: React.FC<Props> = ({ statements, checked, onToggle, onReveal }) => {
  const [height, setHeight] = useState(loadHeight);
  const safeMode = useSqlEditorStore((s) => s.safeMode);
  const variables = useSqlEditorStore((s) => s.variables);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(height));
    } catch {
      /* ignore */
    }
  }, [height]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const clearHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const scheduleHide = () => {
    clearHide();
    // Long delay so the pointer can move into the overlapping popover / click Copy.
    hideTimer.current = setTimeout(() => {
      setPopover(null);
    }, 500);
  };

  const openPopover = (index: number, el: HTMLElement, stmtText: string) => {
    clearHide();
    const rect = el.getBoundingClientRect();
    const resolved = resolveSql(stmtText, variables);
    const width = Math.min(520, Math.max(280, rect.width));
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    // Overlap the row by a few px so there is no gap that dismisses the popover.
    let top = rect.bottom - 4;
    const approxH = 140;
    if (top + approxH > window.innerHeight - 8) {
      top = Math.max(8, rect.top - approxH + 4);
    }
    setPopover({
      index,
      top,
      left,
      width,
      sql: resolved.sql,
      error: resolved.error,
      hasVars: resolved.hasVars,
    });
  };

  const copyText = async (index: number, text: string, hasError?: boolean) => {
    if (hasError || !text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500);
    } catch {
      /* ignore */
    }
  };

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
          const resolved = resolveSql(stmt.text, variables);
          const isCopied = copiedIndex === i;
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
                onMouseEnter={(e) => {
                  if (!resolved.hasVars) return;
                  openPopover(i, e.currentTarget, stmt.text);
                }}
                onMouseLeave={() => {
                  if (!resolved.hasVars) return;
                  scheduleHide();
                }}
                className="flex-1 flex items-start gap-1.5 min-w-0 text-left cursor-pointer"
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
              <button
                type="button"
                data-testid={`sql-statement-copy-row-${i}`}
                title={
                  resolved.error
                    ? resolved.error
                    : resolved.hasVars
                      ? 'Copy query with values'
                      : 'Copy query'
                }
                disabled={Boolean(resolved.error)}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(i, resolved.sql, Boolean(resolved.error));
                }}
                className="shrink-0 mt-0.5 p-0.5 text-slate-600 hover:text-cyan-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-30"
                aria-label={`Copy statement ${i + 1}`}
              >
                {isCopied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
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

      {popover &&
        createPortal(
          <div
            data-testid="sql-statement-values-popover"
            className="fixed z-[80] rounded-md border border-slate-700 bg-slate-900 shadow-xl p-2.5"
            style={{ top: popover.top, left: popover.left, width: popover.width }}
            onMouseEnter={clearHide}
            onMouseLeave={scheduleHide}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {popover.hasVars ? 'Query with values' : 'Query'}
              </span>
              <button
                type="button"
                data-testid="sql-statement-copy"
                disabled={Boolean(popover.error)}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(popover.index, popover.sql, Boolean(popover.error));
                }}
                className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-cyan-300 transition disabled:opacity-40"
              >
                {copiedIndex === popover.index ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copy
                  </>
                )}
              </button>
            </div>
            {popover.error ? (
              <p className="text-[11px] text-rose-400 font-mono break-all">{popover.error}</p>
            ) : (
              <pre className="text-[11px] font-mono text-cyan-300/95 whitespace-pre-wrap break-all max-h-40 overflow-y-auto m-0 leading-snug">
                {popover.sql}
              </pre>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
