import React, { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useSqlEditorStore, type DataPeekEntry } from '../../store/useSqlEditorStore';
import { foreignKeyLinksFor } from '../../lib/tablePreview';
import { DataGrid } from './DataGrid';
import { SQL_ICON_STROKE } from './sqlIconStyle';
import type { TableSchema } from '../../lib/types';

/**
 * Quick data peek: Cmd/Ctrl-click a table in the schema explorer to see its
 * rows without writing a query. Foreign-key cells are links — each FK column
 * can open its own panel below (siblings stack; same column replaces).
 */
const PeekGrid: React.FC<{
  entry: DataPeekEntry;
  tables: TableSchema[] | undefined;
  /** Shorter height when several panels share the modal. */
  compact: boolean;
  showFkHint: boolean;
  onClose?: () => void;
}> = ({ entry, tables, compact, showFkHint, onClose }) => {
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

  const heightClass = compact
    ? 'h-[min(34vh,300px)]'
    : 'h-[min(52vh,460px)]';

  if (entry.status === 'loading') {
    return (
      <div className="flex items-center gap-2 px-3 py-6 text-[12px] text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={SQL_ICON_STROKE} />
        Loading {entry.title}…
      </div>
    );
  }

  if (entry.status === 'error' || !entry.result) {
    return (
      <div className="mx-3 my-2 rounded border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[12px] text-rose-300">
        {entry.error ?? 'Preview failed'}
      </div>
    );
  }

  return (
    <div
      className={`px-2 pb-2 ${heightClass} flex flex-col min-h-0`}
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
      <DataGrid
        result={entry.result}
        exportName={entry.tableName}
        pageSize={undefined}
        linkColumns={linkColumns.size > 0 ? linkColumns : undefined}
        onLinkClick={onLinkClick}
      />
      {showFkHint && linkColumns.size > 0 && (
        <p className="mt-1 px-1 shrink-0 text-[10px] text-slate-500">
          Underlined cells are foreign keys — each column opens its own panel below (e.g. order,
          technician, and lifecycle can all stay open).
        </p>
      )}
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
  const multi = dataPeek.entries.length > 1;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-2 sm:p-4"
      data-testid="data-peek"
      onClick={closeDataPeek}
    >
      <div
        className="flex flex-col w-[min(98vw,1480px)] h-[min(94vh,920px)] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
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
              compact={multi}
              showFkHint
            />
          )}
          {drills.length > 0 && (
            <div
              className={`px-1 grid gap-2 ${
                drills.length === 1
                  ? 'grid-cols-1'
                  : drills.length === 2
                    ? 'grid-cols-1 lg:grid-cols-2'
                    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
              }`}
              data-testid="data-peek-drills"
            >
              {drills.map((e) => (
                <div
                  key={e.id}
                  className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/40"
                >
                  <PeekGrid
                    entry={e}
                    tables={tables}
                    compact
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
