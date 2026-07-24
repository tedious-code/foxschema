import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Database, AlertCircle, GripVertical, RefreshCw } from 'lucide-react';
import type { CredentialRun } from '../../store/useSqlEditorStore';
import type { ResultsLayout } from '../../store/sqlEditorTabLogic';
import { DataGrid, PANE_DEFAULT_PX, PANE_MIN_PX } from './DataGrid';
import type { SqlStatementResult } from '../../api/sqlApi';

interface Props {
  runs: CredentialRun[];
  /** The statements the run executed, for grid labels ("Query 1 · SELECT …"). */
  statements: string[];
  layout: ResultsLayout;
  /** True while any execute is in flight for this tab. */
  refreshing?: boolean;
  /** Non-fatal run messages (e.g. `@set` failures). */
  warnings?: string[];
  /** Re-run for one credential, or all when omitted. */
  onRefresh?: (connectionId?: string) => void;
}

const GAP_PX = 6; // space between pane and its resize grip

const statementLabel = (sql: string, index: number): string => {
  const compact = sql.replace(/\s+/g, ' ').trim();
  return `Query ${index + 1} · ${compact.length > 48 ? compact.slice(0, 48) + '…' : compact}`;
};

const credentialLabel = (run: CredentialRun): string => `${run.name} [${run.dialect}]`;

type PaneItem =
  | {
      key: string;
      kind: 'grid';
      result: SqlStatementResult;
      label: string;
      exportName: string;
      connectionId: string;
    }
  | { key: string; kind: 'running'; label: string; connectionId: string }
  | { key: string; kind: 'error'; label: string; error: string; connectionId: string };

function equalWidths(count: number, containerW: number): number[] {
  if (count <= 0) return [];
  const gripTotal = count * (8 + GAP_PX); // grip + gap per pane
  const avail = Math.max(count * PANE_MIN_PX, containerW - gripTotal);
  const each = Math.max(PANE_MIN_PX, Math.floor(avail / count));
  return Array.from({ length: count }, () => each);
}

/**
 * Horizontal row of result panes. Every table has its own drag grip on the
 * right edge — widths are independent (growing one does not crush neighbors;
 * the row scrolls when panes exceed the viewport).
 */
const ResizablePaneRow: React.FC<{
  items: PaneItem[];
  rowKey: string;
  refreshing?: boolean;
  onRefresh?: (connectionId: string) => void;
}> = ({ items, rowKey, refreshing, onRefresh }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>(() => items.map(() => PANE_DEFAULT_PX));
  const sizedForKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || items.length === 0) return;

    const applyEqual = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      // Re-equalize when the row identity changes (new query / layout), not on every resize.
      if (sizedForKey.current === rowKey) return;
      sizedForKey.current = rowKey;
      setWidths(equalWidths(items.length, w));
    };

    applyEqual();
    const ro = new ResizeObserver(() => {
      // If user hasn't customized yet for this rowKey, keep filling.
      if (sizedForKey.current !== rowKey) applyEqual();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length, rowKey]);

  useEffect(() => {
    setWidths((prev) => {
      if (prev.length === items.length) return prev;
      if (prev.length < items.length) {
        return [...prev, ...Array.from({ length: items.length - prev.length }, () => PANE_DEFAULT_PX)];
      }
      return prev.slice(0, items.length);
    });
  }, [items.length]);

  const startPaneResize = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[index] ?? PANE_DEFAULT_PX;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(PANE_MIN_PX, startW + (ev.clientX - startX));
      setWidths((prev) => {
        if (prev[index] === next) return prev;
        const copy = [...prev];
        copy[index] = next;
        return copy;
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [widths]);

  if (items.length === 0) return null;

  return (
    <div
      ref={rowRef}
      className="flex overflow-x-auto overflow-y-hidden items-stretch pb-1 gap-0"
      style={{ minHeight: '20rem', height: 'min(28rem, 55vh)' }}
      data-testid="sql-result-pane-row"
    >
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          <div
            className="flex flex-col min-h-0 shrink-0"
            style={{ width: widths[i] ?? PANE_DEFAULT_PX, minWidth: PANE_MIN_PX }}
          >
            {item.kind === 'grid' && (
              <DataGrid
                result={item.result}
                label={item.label}
                exportName={item.exportName}
                refreshing={refreshing}
                onRefresh={onRefresh ? () => onRefresh(item.connectionId) : undefined}
              />
            )}
            {item.kind === 'running' && (
              <div className="flex items-center gap-2 text-xs text-slate-500 h-full px-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {item.label}
              </div>
            )}
            {item.kind === 'error' && (
              <div className="flex flex-col gap-2 h-full min-h-0">
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate flex-1"
                    title={item.label}
                  >
                    {item.label}
                  </div>
                  {onRefresh && (
                    <button
                      type="button"
                      data-testid="sql-pane-refresh"
                      title="Retry this server"
                      disabled={refreshing}
                      onClick={() => onRefresh(item.connectionId)}
                      className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-cyan-400 transition shrink-0 disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                  )}
                </div>
                <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2 flex-1 overflow-auto">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="break-all">{item.error}</span>
                </div>
              </div>
            )}
          </div>
          {/* Every pane — including the last — gets a resize grip */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize table ${i + 1}`}
            data-testid="sql-pane-resize"
            title="Drag to resize this table"
            onMouseDown={(e) => startPaneResize(i, e)}
            className="w-2 shrink-0 cursor-col-resize self-stretch mx-0.5 rounded-sm bg-slate-800 hover:bg-cyan-600/70 active:bg-cyan-500 flex items-center justify-center group"
          >
            <GripVertical className="w-3 h-3 text-slate-500 group-hover:text-cyan-200 pointer-events-none" />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

/**
 * Results for one tab. `byCredential` stacks credentials (each row's statement
 * grids side by side). `sideBySide` stacks statements (credential grids as
 * columns). Every result table is independently resizable.
 */
export const ResultsPanel: React.FC<Props> = ({
  runs,
  statements,
  layout,
  refreshing,
  warnings,
  onRefresh,
}) => {
  if (runs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-xs gap-2">
        <Database className="w-4 h-4" /> Run a query to see results here — one row per checked credential.
      </div>
    );
  }

  const warningBanner =
    warnings && warnings.length > 0 ? (
      <div
        className="mx-4 mt-3 flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-xs text-amber-200/90"
        data-testid="sql-results-warnings"
        role="status"
      >
        {warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span className="break-all">{w}</span>
          </div>
        ))}
      </div>
    ) : null;

  if (layout === 'sideBySide') {
    const stmtCount = Math.max(statements.length, ...runs.map((r) => r.results?.length ?? 0), 0);
    return (
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-4" data-testid="sql-results-side-by-side">
        {warningBanner}
        <div className="flex flex-col gap-4 px-4 pt-1">
        {Array.from({ length: stmtCount }, (_, i) => {
          const items: PaneItem[] = [];
          for (const run of runs) {
            if (run.status === 'running') {
              items.push({
                key: `${run.connectionId}-run`,
                kind: 'running',
                label: credentialLabel(run),
                connectionId: run.connectionId,
              });
              continue;
            }
            if (run.status === 'error') {
              items.push({
                key: `${run.connectionId}-err`,
                kind: 'error',
                label: credentialLabel(run),
                error: run.error ?? 'Error',
                connectionId: run.connectionId,
              });
              continue;
            }
            const result = run.results?.[i];
            if (!result) continue;
            items.push({
              key: `${run.connectionId}-q${i}`,
              kind: 'grid',
              result,
              label: credentialLabel(run),
              exportName: `${run.name}-q${i + 1}`,
              connectionId: run.connectionId,
            });
          }
          return (
            <section key={i} className="flex flex-col gap-2 min-w-0">
              <header className="text-xs font-bold text-slate-200 shrink-0">
                {statementLabel(statements[i] ?? '', i)}
              </header>
              <ResizablePaneRow
                items={items}
                rowKey={`side-${i}-${items.map((x) => x.key).join('|')}`}
                refreshing={refreshing}
                onRefresh={onRefresh}
              />
            </section>
          );
        })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-4" data-testid="sql-results-by-credential">
      {warningBanner}
      <div className="flex flex-col gap-4 px-4 pt-1">
      {runs.map((run) => {
        const items: PaneItem[] =
          run.status === 'done' && run.results
            ? run.results.map((result, i) => ({
                key: `${run.connectionId}-q${i}`,
                kind: 'grid' as const,
                result,
                label: statementLabel(statements[i] ?? '', i),
                exportName: `${run.name}-q${i + 1}`,
                connectionId: run.connectionId,
              }))
            : [];

        return (
          <section key={run.connectionId} className="flex flex-col gap-2 min-w-0">
            <header className="flex items-center gap-2 text-xs font-bold text-slate-200 shrink-0">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              {run.name}
              <span className="text-[10px] font-semibold text-slate-500 uppercase">[{run.dialect}]</span>
              {run.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
              {onRefresh && run.status !== 'running' && (
                <button
                  type="button"
                  data-testid="sql-cred-refresh"
                  title="Refresh this server"
                  disabled={refreshing}
                  onClick={() => onRefresh(run.connectionId)}
                  className="ml-auto flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-cyan-400 transition disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
                </button>
              )}
            </header>

            {run.status === 'error' && (
              <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2 max-w-2xl">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-all">{run.error}</span>
              </div>
            )}

            {run.status === 'done' && items.length > 0 && (
              <ResizablePaneRow
                items={items}
                rowKey={`cred-${run.connectionId}-${items.length}`}
                refreshing={refreshing}
                onRefresh={onRefresh}
              />
            )}
          </section>
        );
      })}
      </div>
    </div>
  );
};
