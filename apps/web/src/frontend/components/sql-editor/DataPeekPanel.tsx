import React, { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Loader2, X } from 'lucide-react';
import { useSqlEditorStore, type DataPeekEntry } from '../../store/useSqlEditorStore';
import { foreignKeyLinksFor } from '../../lib/tablePreview';
import { DataGrid } from './DataGrid';
import { SQL_ICON_STROKE } from './sqlIconStyle';
import type { TableSchema } from '../../lib/types';

/**
 * Quick data peek: Cmd/Ctrl-click a table in the schema explorer to see its
 * rows without writing a query. Foreign-key cells are links — clicking one
 * appends the parent's rows as another grid below, so you can follow a
 * relationship a couple of hops without leaving the popup.
 */
const PeekGrid: React.FC<{
  entry: DataPeekEntry;
  tables: TableSchema[] | undefined;
  isLast: boolean;
}> = ({ entry, tables, isLast }) => {
  const drillDataPeek = useSqlEditorStore((s) => s.drillDataPeek);

  // A drilled entry's table comes from `fk.referencedTable`, which several
  // catalogs report schema-qualified ("public.customers") while the cache is
  // keyed on the bare name. Match on both, or the second hop silently loses
  // its own FK links.
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
    <div className="px-2 pb-2" data-testid={`data-peek-grid-${entry.id}`}>
      <DataGrid
        result={entry.result}
        label={entry.title}
        exportName={entry.tableName}
        pageSize={undefined}
        linkColumns={linkColumns.size > 0 ? linkColumns : undefined}
        onLinkClick={onLinkClick}
      />
      {isLast && linkColumns.size > 0 && (
        <p className="mt-1 px-1 text-[10px] text-slate-500">
          Underlined cells are foreign keys — click one to open the related rows below.
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6"
      data-testid="data-peek"
      onClick={closeDataPeek}
    >
      <div
        className="flex flex-col w-full max-w-6xl max-h-full rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-wide text-cyan-400">
            Data peek
          </span>
          {/* Breadcrumb of the drill path; click a crumb to go back to it. */}
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
            {dataPeek.entries.map((e, i) => (
              <React.Fragment key={e.id}>
                {i > 0 && (
                  <ChevronRight
                    className="w-3 h-3 text-slate-600 shrink-0"
                    strokeWidth={SQL_ICON_STROKE}
                  />
                )}
                <button
                  type="button"
                  data-testid={`data-peek-crumb-${i}`}
                  title={i === 0 ? e.title : `Back to ${e.title}`}
                  onClick={() => {
                    const next = dataPeek.entries[i + 1];
                    if (next) closeDataPeekFrom(next.id);
                  }}
                  className={`shrink-0 max-w-[16rem] truncate text-[12px] font-semibold ${
                    i === dataPeek.entries.length - 1
                      ? 'text-slate-200'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  {e.title}
                </button>
              </React.Fragment>
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

        <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
          {dataPeek.entries.map((e, i) => (
            <PeekGrid
              key={e.id}
              entry={e}
              tables={tables}
              isLast={i === dataPeek.entries.length - 1}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
