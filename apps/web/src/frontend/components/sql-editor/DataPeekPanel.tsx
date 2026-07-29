import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useSqlEditorStore, type DataPeekEntry } from '../../store/useSqlEditorStore';
import { foreignKeyLinksFor } from '../../lib/tablePreview';
import { DataGrid } from './DataGrid';
import { SQL_ICON_STROKE } from './sqlIconStyle';
import type { TableSchema } from '../../lib/types';

const DEFAULT_HEIGHT_ROOT = 460;
/** FK drill panels stack full-width; keep them tall enough for a usable grid. */
const DEFAULT_HEIGHT_DRILL = 400;
const MIN_PANEL_HEIGHT = 220;
const MAX_PANEL_HEIGHT = 900;

/**
 * Quick data peek: Cmd/Ctrl-click a table in the schema explorer to see its
 * rows without writing a query. Foreign-key cells are links — each FK column
 * can open its own panel below (siblings stack; same column replaces).
 * Each panel has WHERE / ORDER BY / LIMIT and a drag resize handle.
 */
const PeekFilterBar: React.FC<{
  entry: DataPeekEntry;
  disabled?: boolean;
}> = ({ entry, disabled }) => {
  const updateDataPeekFilters = useSqlEditorStore((s) => s.updateDataPeekFilters);
  const [where, setWhere] = useState(entry.whereClause);
  const [orderBy, setOrderBy] = useState(entry.orderByClause);
  const [limit, setLimit] = useState(String(entry.limit));

  useEffect(() => {
    setWhere(entry.whereClause);
    setOrderBy(entry.orderByClause);
    setLimit(String(entry.limit));
  }, [entry.id, entry.whereClause, entry.orderByClause, entry.limit]);

  const apply = useCallback(() => {
    const parsed = Number.parseInt(limit, 10);
    void updateDataPeekFilters(entry.id, {
      whereClause: where,
      orderByClause: orderBy,
      limit: Number.isFinite(parsed) ? parsed : entry.limit,
    });
  }, [entry.id, entry.limit, where, orderBy, limit, updateDataPeekFilters]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 mb-1.5 shrink-0 px-0.5"
      data-testid={`data-peek-filters-${entry.id}`}
    >
      <label className="flex items-center gap-1 min-w-0 flex-[2] basis-[12rem]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 shrink-0">
          Where
        </span>
        <input
          type="text"
          data-testid={`data-peek-where-${entry.id}`}
          placeholder="e.g. ARCHIVED = false"
          value={where}
          disabled={disabled}
          onChange={(e) => setWhere(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-600"
        />
      </label>
      <label className="flex items-center gap-1 min-w-0 flex-1 basis-[9rem]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 shrink-0">
          Order by
        </span>
        <input
          type="text"
          data-testid={`data-peek-order-${entry.id}`}
          placeholder="ID DESC"
          value={orderBy}
          disabled={disabled}
          onChange={(e) => setOrderBy(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-600"
        />
      </label>
      <label className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Limit
        </span>
        <input
          type="number"
          min={1}
          max={5000}
          data-testid={`data-peek-limit-${entry.id}`}
          value={limit}
          disabled={disabled}
          onChange={(e) => setLimit(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] font-mono text-slate-100 focus:outline-none focus:border-cyan-600"
        />
      </label>
      <button
        type="button"
        data-testid={`data-peek-apply-${entry.id}`}
        disabled={disabled}
        onClick={apply}
        className="shrink-0 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
      >
        Apply
      </button>
    </div>
  );
};

const PeekResizeHandle: React.FC<{
  entryId: string;
  heightPx: number;
}> = ({ entryId, heightPx }) => {
  const setDataPeekPanelHeight = useSqlEditorStore((s) => s.setDataPeekPanelHeight);
  const startY = useRef(0);
  const startH = useRef(heightPx);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    startY.current = e.clientY;
    startH.current = heightPx;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(
        MAX_PANEL_HEIGHT,
        Math.max(MIN_PANEL_HEIGHT, startH.current + (ev.clientY - startY.current))
      );
      setDataPeekPanelHeight(entryId, next);
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize data peek panel"
      data-testid={`data-peek-resize-${entryId}`}
      onPointerDown={onPointerDown}
      className="h-2.5 shrink-0 cursor-ns-resize flex items-center justify-center group"
      title="Drag to resize"
    >
      <span className="block h-1 w-12 rounded-full bg-slate-600 group-hover:bg-cyan-500" />
    </div>
  );
};

const PeekGrid: React.FC<{
  entry: DataPeekEntry;
  tables: TableSchema[] | undefined;
  /** Root table vs FK drill — drills get a taller default for usable grids. */
  variant: 'root' | 'drill';
  showFkHint: boolean;
  onClose?: () => void;
}> = ({ entry, tables, variant, showFkHint, onClose }) => {
  const drillDataPeek = useSqlEditorStore((s) => s.drillDataPeek);

  const table = useMemo(() => {
    if (!tables) return undefined;
    const wanted = entry.tableName.toLowerCase();
    const bare = wanted.replace(/^.*\./, '');
    return (
      tables.find((t) => t.name.toLowerCase() === wanted) ??
      tables.find((t) => t.name.toLowerCase().replace(/^.*\./, '') === bare)
    );
  }, [tables, entry.tableName]);

  const links = useMemo(
    () => (entry.result?.ok ? foreignKeyLinksFor(table, entry.result.columns) : []),
    [table, entry.result]
  );

  const linkColumns = useMemo(() => {
    const map = new Map<number, string>();
    for (const l of links) map.set(l.columnIndex, l.fk.referencedTable);
    return map;
  }, [links]);

  const onLinkClick = useCallback(
    (colIdx: number, rowIdx: number) => {
      const link = links.find((l) => l.columnIndex === colIdx);
      if (!link || !entry.result?.ok) return;
      const row = entry.result.rows[rowIdx];
      if (!row) return;
      void drillDataPeek(entry.id, link.fk, link.valueIndexes.map((i) => row[i]));
    },
    [links, entry, drillDataPeek]
  );

  const heightPx =
    entry.panelHeightPx ?? (variant === 'drill' ? DEFAULT_HEIGHT_DRILL : DEFAULT_HEIGHT_ROOT);

  return (
    <div
      className="px-2 pb-1 flex flex-col min-h-0 w-full"
      style={{ height: heightPx }}
      data-testid={`data-peek-grid-${entry.id}`}
    >
      <div className="flex items-center gap-2 mb-1 shrink-0 min-w-0">
        <span className="text-[12px] font-semibold text-slate-200 truncate flex-1" title={entry.title}>
          {entry.title}
        </span>
        {onClose && (
          <button
            type="button"
            data-testid={`data-peek-close-panel-${entry.id}`}
            title="Close this panel"
            aria-label={`Close ${entry.title}`}
            onClick={onClose}
            className="p-0.5 text-slate-500 hover:text-slate-200 shrink-0"
          >
            <X className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
          </button>
        )}
      </div>

      <PeekFilterBar entry={entry} disabled={entry.status === 'loading'} />

      {entry.status === 'loading' && (
        <div className="flex items-center gap-2 px-1 py-4 text-[12px] text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={SQL_ICON_STROKE} />
          Loading {entry.title}…
        </div>
      )}

      {(entry.status === 'error' || (entry.status === 'ready' && !entry.result)) && (
        <div className="mx-0.5 my-1 rounded border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[12px] text-rose-300">
          {entry.error ?? 'Preview failed'}
        </div>
      )}

      {entry.status === 'ready' && entry.result && (
        <div className="flex-1 min-h-0 flex flex-col">
          <DataGrid
            result={entry.result}
            exportName={entry.tableName}
            pageSize={entry.limit}
            linkColumns={linkColumns.size > 0 ? linkColumns : undefined}
            onLinkClick={onLinkClick}
          />
          {showFkHint && linkColumns.size > 0 && (
            <p className="mt-1 px-1 shrink-0 text-[10px] text-slate-500">
              Underlined rust-colored cells are foreign keys — click orderID and technicianID to open
              both panels stacked below.
            </p>
          )}
        </div>
      )}

      <PeekResizeHandle entryId={entry.id} heightPx={heightPx} />
    </div>
  );
};

export const DataPeekPanel: React.FC = () => {
  const dataPeek = useSqlEditorStore((s) => s.dataPeek);
  const closeDataPeek = useSqlEditorStore((s) => s.closeDataPeek);
  const closeDataPeekFrom = useSqlEditorStore((s) => s.closeDataPeekFrom);
  const schemaCache = useSqlEditorStore((s) => s.schemaCache);

  useEffect(() => {
    if (!dataPeek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDataPeek();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dataPeek, closeDataPeek]);

  if (!dataPeek) return null;
  const tables = schemaCache[dataPeek.connectionId]?.tables;
  const root = dataPeek.entries.find((e) => !e.parentId) ?? dataPeek.entries[0];
  const drills = dataPeek.entries.filter((e) => e.parentId);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-1.5 sm:p-3"
      data-testid="data-peek"
      onClick={closeDataPeek}
    >
      <div
        className="flex flex-col w-[min(99vw,1680px)] h-[min(96vh,980px)] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-wide text-cyan-400 shrink-0">
            Data peek
          </span>
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto">
            {dataPeek.entries.map((e) => (
              <span
                key={e.id}
                className="inline-flex items-center gap-1 shrink-0 max-w-[14rem] rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-0.5"
                title={e.title}
              >
                <span className="truncate text-[11px] font-semibold text-slate-300">{e.title}</span>
                {e.parentId && (
                  <button
                    type="button"
                    data-testid={`data-peek-crumb-close-${e.id}`}
                    title="Close panel"
                    aria-label={`Close ${e.title}`}
                    onClick={() => closeDataPeekFrom(e.id)}
                    className="text-slate-500 hover:text-slate-200"
                  >
                    <X className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} />
                  </button>
                )}
              </span>
            ))}
          </div>
          <button
            type="button"
            data-testid="data-peek-close"
            title="Close (Esc)"
            aria-label="Close data peek"
            onClick={closeDataPeek}
            className="p-1 text-slate-400 hover:text-slate-100 shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={SQL_ICON_STROKE} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 py-1">
          {root && (
            <PeekGrid
              entry={root}
              tables={tables}
              variant="root"
              showFkHint
            />
          )}
          {drills.length > 0 && (
            <div className="px-1 flex flex-col gap-3" data-testid="data-peek-drills">
              {drills.map((e) => (
                <div
                  key={e.id}
                  className="min-w-0 w-full rounded-lg border border-slate-800 bg-slate-950/40"
                >
                  <PeekGrid
                    entry={e}
                    tables={tables}
                    variant="drill"
                    showFkHint={false}
                    onClose={() => closeDataPeekFrom(e.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
