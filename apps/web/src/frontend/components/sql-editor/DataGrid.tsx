import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, GripVertical, RefreshCw } from 'lucide-react';
import type { SqlStatementResult } from '../../api/sqlApi';
import { columnToListValues, rowsForTableVariable } from '../../lib/sql-variables';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { downloadCsv } from '../../utils/exportCsv';

const CELL_MAX = 200;
const COL_MIN_PX = 96;
const COL_DEFAULT_PX = 128;
const COL_MAX_PX = 220;
const COL_LONG_TEXT_PX = 200;
/** Upper bound when double-clicking a header to fit content. */
const COL_FIT_MAX_PX = 720;
const ROW_NUM_PX = 48;
/** Fixed row height for windowing (must match rendered row). */
const ROW_H_PX = 28;
const OVERSCAN = 8;

const LONG_TEXT_NAME =
  /^(description|reason|comment|comments|note|notes|message|messages|remark|remarks|detail|details|summary|body|content|text|memo|explanation|error|errmsg|err_msg)$/i;

type CellKind = 'null' | 'number' | 'boolean' | 'datetime' | 'binary' | 'string';

const KIND_CELL_CLASS: Record<CellKind, string> = {
  null: 'italic text-[#94a3b8]',
  number: 'text-[#1d4ed8]',
  boolean: 'text-[#7c3aed]',
  datetime: 'text-[#0f766e]',
  binary: 'text-[#b45309]',
  string: 'text-[#1e293b]',
};

const KIND_HEADER_CLASS: Record<Exclude<CellKind, 'null'>, string> = {
  number: 'text-[#1d4ed8]',
  boolean: 'text-[#7c3aed]',
  datetime: 'text-[#0f766e]',
  binary: 'text-[#b45309]',
  string: 'text-[#64748b]',
};

const KIND_LABEL: Record<Exclude<CellKind, 'null'>, string> = {
  number: 'num',
  boolean: 'bool',
  datetime: 'date',
  binary: 'bin',
  string: 'text',
};

// Anchored digit/date forms — no nested quantifiers that can ReDoS.
const ISO_DATE_RE =
  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: fully anchored, bounded optional groups
  /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
// eslint-disable-next-line security/detect-unsafe-regex -- false positive: simple digit classes, fully anchored
const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const BINARY_RE = /^0x[0-9a-fA-F…]+$/;

function inferCellKind(value: unknown): CellKind {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return 'string';
    if (s === 'true' || s === 'false') return 'boolean';
    if (BINARY_RE.test(s)) return 'binary';
    if (ISO_DATE_RE.test(s)) return 'datetime';
    if (NUMERIC_STRING_RE.test(s) && s.length <= 40) return 'number';
    return 'string';
  }
  return 'string';
}

function inferColumnKind(sampleValues: unknown[]): Exclude<CellKind, 'null'> {
  const counts: Record<Exclude<CellKind, 'null'>, number> = {
    number: 0,
    boolean: 0,
    datetime: 0,
    binary: 0,
    string: 0,
  };
  for (const v of sampleValues) {
    const k = inferCellKind(v);
    if (k === 'null') continue;
    counts[k] += 1;
  }
  let best: Exclude<CellKind, 'null'> = 'string';
  let bestN = -1;
  for (const k of Object.keys(counts) as Exclude<CellKind, 'null'>[]) {
    if (counts[k] > bestN) {
      best = k;
      bestN = counts[k];
    }
  }
  return best;
}

function identityOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function reorder(order: number[], from: number, to: number): number[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return order;
  }
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

function defaultWidthFor(colName: string, sampleValues: unknown[]): number {
  const headerPx = colName.length * 8 + 40;
  let contentPx = 0;
  for (const v of sampleValues) {
    if (v === null || v === undefined) continue;
    contentPx = Math.max(contentPx, Math.min(String(v).length, 40) * 7.2);
  }
  const isLongText =
    LONG_TEXT_NAME.test(colName.trim()) ||
    /desc|reason|comment|message|remark|note|detail/i.test(colName);
  const raw = Math.max(headerPx, contentPx, COL_DEFAULT_PX);
  const cap = isLongText ? COL_LONG_TEXT_PX : COL_MAX_PX;
  return Math.min(cap, Math.max(COL_MIN_PX, Math.round(raw)));
}

function computeColWidths(columns: string[], rows: unknown[][]): number[] {
  const sample = rows.slice(0, 40);
  return columns.map((name, i) => defaultWidthFor(name, sample.map((r) => r[i])));
}

function computeColKinds(columns: string[], rows: unknown[][]): Exclude<CellKind, 'null'>[] {
  const sample = rows.slice(0, 40);
  return columns.map((_, i) => inferColumnKind(sample.map((r) => r[i])));
}

/** Fast display text — no React element per cell. */
function cellDisplay(value: unknown): { text: string; title: string; isNull: boolean } {
  if (value === null || value === undefined) {
    return { text: 'NULL', title: 'NULL', isNull: true };
  }
  const raw = typeof value === 'string' ? value : String(value);
  if (raw.length > CELL_MAX) {
    return { text: `${raw.slice(0, CELL_MAX)}…`, title: raw, isNull: false };
  }
  return { text: raw, title: raw, isNull: false };
}

function fitWidthFor(colName: string, sampleValues: unknown[]): number {
  const headerPx = colName.length * 8 + 40;
  let contentPx = 0;
  for (const v of sampleValues) {
    if (v === null || v === undefined) continue;
    contentPx = Math.max(contentPx, Math.min(String(v).length, 120) * 7.2);
  }
  const raw = Math.max(headerPx, contentPx, COL_DEFAULT_PX);
  return Math.min(COL_FIT_MAX_PX, Math.max(COL_MIN_PX, Math.round(raw)));
}

function savePromptTitle(mode: 'scalar' | 'list' | 'table'): string {
  if (mode === 'scalar') return 'Save cell as variable';
  if (mode === 'list') return 'Save column as list';
  return 'Save result as table';
}

function GridToolbar({
  label,
  refreshing,
  onRefresh,
  onExport,
}: {
  label?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  onExport?: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 mb-1 shrink-0">
      {label && (
        <div
          className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate flex-1"
          title={label}
        >
          {label}
        </div>
      )}
      {onRefresh && (
        <button
          type="button"
          data-testid="sql-pane-refresh"
          title="Refresh this server"
          disabled={refreshing}
          onClick={onRefresh}
          className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-cyan-400 transition shrink-0 disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      )}
      {onExport && (
        <button
          type="button"
          title="Export CSV"
          onClick={onExport}
          className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-cyan-400 transition shrink-0"
        >
          <Download className="w-3 h-3" /> CSV
        </button>
      )}
    </div>
  );
}

/**
 * Result grid — virtualized rows, column-level type colors (no per-cell regex).
 * Right-click a cell or column header to save as a SQL Editor variable.
 */
export const DataGrid: React.FC<{
  result: SqlStatementResult;
  label?: string;
  exportName?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Sync vertical scroll by row index with sibling grids in the same row. */
  syncScrollRow?: number | null;
  onSyncScrollRow?: (rowIndex: number) => void;
  /** 0-based page index for server-side paging. */
  pageIndex?: number;
  /** Rows requested per page (Max rows / Rows/page). */
  pageSize?: number;
  hasPrevPage?: boolean;
  hasNextPage?: boolean;
  pageLoading?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
}> = React.memo(
  ({
    result,
    label,
    exportName = 'query-result',
    refreshing,
    onRefresh,
    syncScrollRow,
    onSyncScrollRow,
    pageIndex = 0,
    pageSize,
    hasPrevPage,
    hasNextPage,
    pageLoading,
    onPrevPage,
    onNextPage,
  }) => {
  const upsertVariable = useSqlEditorStore((s) => s.upsertVariable);
  const sourceColumns = result.ok ? result.columns : [];
  const sourceRows = result.ok ? result.rows : [];
  const [colOrder, setColOrder] = useState<number[]>(() => identityOrder(sourceColumns.length));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(() =>
    computeColWidths(sourceColumns, sourceRows)
  );
  const [fittedCols, setFittedCols] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<
    | { kind: 'cell'; x: number; y: number; colIdx: number; value: unknown }
    | { kind: 'column'; x: number; y: number; colIdx: number }
    | { kind: 'grid'; x: number; y: number }
    | null
  >(null);
  const [savePrompt, setSavePrompt] = useState<
    | { mode: 'scalar'; value: unknown; defaultName: string }
    | { mode: 'list'; colIdx: number; defaultName: string }
    | { mode: 'table'; defaultName: string }
    | null
  >(null);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(320);
  const rafRef = useRef(0);
  const syncLock = useRef(false);

  const colKey = sourceColumns.join('\0');
  const colKinds = useMemo(
    () => computeColKinds(sourceColumns, sourceRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colKey captures column identity; rowCount covers data refresh
    [colKey, sourceRows.length, result.ok ? result.rowCount : 0]
  );

  useEffect(() => {
    setColOrder(identityOrder(sourceColumns.length));
    setColWidths(computeColWidths(sourceColumns, sourceRows));
    setFittedCols(new Set());
    setDragFrom(null);
    setDragOver(null);
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [colKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 320);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [result.ok, sourceColumns.length]);

  useEffect(() => {
    if (syncScrollRow == null || !scrollRef.current) return;
    const target = syncScrollRow * ROW_H_PX;
    if (Math.abs(scrollRef.current.scrollTop - target) < 2) return;
    syncLock.current = true;
    scrollRef.current.scrollTop = target;
    setScrollTop(target);
    requestAnimationFrame(() => {
      syncLock.current = false;
    });
  }, [syncScrollRow]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setScrollTop(el.scrollTop);
      if (!syncLock.current && onSyncScrollRow) {
        onSyncScrollRow(Math.floor(el.scrollTop / ROW_H_PX));
      }
    });
  }, [onSyncScrollRow]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const startColResize = useCallback((colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colIdx] ?? COL_DEFAULT_PX;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(COL_FIT_MAX_PX, Math.max(COL_MIN_PX, startW + (ev.clientX - startX)));
      setColWidths((prev) => {
        const copy = [...prev];
        while (copy.length <= colIdx) copy.push(COL_DEFAULT_PX);
        copy[colIdx] = next;
        return copy;
      });
      setFittedCols((prev) => {
        if (!prev.has(colIdx)) return prev;
        const n = new Set(prev);
        n.delete(colIdx);
        return n;
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
  }, [colWidths]);

  const onHeaderDoubleClick = useCallback(
    (colIdx: number) => {
      const name = sourceColumns[colIdx] ?? '';
      const sample = sourceRows.slice(0, 80).map((r) => r[colIdx]);
      setColWidths((prev) => {
        const copy = [...prev];
        while (copy.length <= colIdx) copy.push(COL_DEFAULT_PX);
        if (fittedCols.has(colIdx)) {
          copy[colIdx] = defaultWidthFor(name, sample);
        } else {
          copy[colIdx] = fitWidthFor(name, sample);
        }
        return copy;
      });
      setFittedCols((prev) => {
        const n = new Set(prev);
        if (n.has(colIdx)) n.delete(colIdx);
        else n.add(colIdx);
        return n;
      });
    },
    [fittedCols, sourceColumns, sourceRows]
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  useEffect(() => {
    if (savePrompt) {
      setSaveName(savePrompt.defaultName);
      setSaveError(null);
      queueMicrotask(() => saveInputRef.current?.select());
    }
  }, [savePrompt]);

  const commitSave = () => {
    if (!savePrompt) return;
    const existing = useSqlEditorStore.getState().variables.find((v) => v.name === saveName.trim());
    if (existing && !window.confirm(`Overwrite variable "${saveName.trim()}"?`)) return;

    let err: string | null;
    if (savePrompt.mode === 'scalar') {
      err = upsertVariable({ name: saveName, kind: 'scalar', value: savePrompt.value });
    } else if (savePrompt.mode === 'list') {
      const values = columnToListValues(sourceRows, savePrompt.colIdx);
      err = upsertVariable({ name: saveName, kind: 'list', values });
    } else {
      err = upsertVariable({
        name: saveName,
        kind: 'table',
        columns: [...sourceColumns],
        rows: rowsForTableVariable(sourceRows),
      });
    }
    if (err) {
      setSaveError(err);
      return;
    }
    setSavePrompt(null);
    setMenu(null);
  };

  if (!result.ok) {
    return (
      <div className="w-full min-w-0 flex flex-col">
        <GridToolbar label={label} refreshing={refreshing} onRefresh={onRefresh} />
        <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-all">{result.error}</span>
        </div>
      </div>
    );
  }

  const order =
    colOrder.length === sourceColumns.length ? colOrder : identityOrder(sourceColumns.length);
  const orderedColumns = order.map((i) => sourceColumns[i]!);
  const tableWidth =
    ROW_NUM_PX + order.reduce((sum, i) => sum + (colWidths[i] ?? COL_DEFAULT_PX), 0);
  const colCount = 1 + order.length;

  const totalRows = sourceRows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H_PX) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / ROW_H_PX) + OVERSCAN * 2;
  const end = Math.min(totalRows, start + visibleCount);
  const padTop = start * ROW_H_PX;
  const padBottom = Math.max(0, (totalRows - end) * ROW_H_PX);

  const exportOrdered = () => {
    const orderedRows = sourceRows.map((row) => order.map((i) => row[i]));
    downloadCsv(exportName, orderedColumns, orderedRows);
  };

  return (
    <div className="w-full min-w-0 h-full flex flex-col min-h-0">
      <GridToolbar
        label={label}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onExport={sourceColumns.length > 0 ? exportOrdered : undefined}
      />
      <div
        ref={scrollRef}
        data-testid="sql-data-grid"
        className="fox-sql-grid flex-1 min-h-0 border border-slate-700/80 rounded-lg shadow-sm bg-slate-50"
        style={{ overflowX: 'auto', overflowY: 'auto' }}
        onScroll={onScroll}
        onContextMenu={(e) => {
          // Empty area / row-number context: save whole result as table.
          if ((e.target as HTMLElement).closest('td, th')) return;
          e.preventDefault();
          setMenu({ kind: 'grid', x: e.clientX, y: e.clientY });
        }}
      >
        {sourceColumns.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[#64748b] italic">
            0 rows (column names unavailable for empty results)
          </div>
        ) : (
          <table
            className="text-left border-collapse text-xs whitespace-nowrap table-fixed"
            style={{ width: tableWidth, minWidth: '100%' }}
          >
            <colgroup>
              <col style={{ width: ROW_NUM_PX, minWidth: ROW_NUM_PX }} />
              {order.map((colIdx) => (
                <col
                  key={colIdx}
                  style={{
                    width: colWidths[colIdx] ?? COL_DEFAULT_PX,
                    minWidth: COL_MIN_PX,
                  }}
                />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-200/90 border-b border-slate-300 text-slate-800">
                <th
                  className="sticky left-0 z-20 px-1.5 py-1.5 text-center font-bold text-slate-500 bg-slate-200/90 border-r border-slate-300 select-none"
                  style={{ width: ROW_NUM_PX, minWidth: ROW_NUM_PX }}
                  title="Row number — right-click to save result as table"
                  aria-label="Row number"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({ kind: 'grid', x: e.clientX, y: e.clientY });
                  }}
                >
                  #
                </th>
                {order.map((colIdx, visualIdx) => {
                  const name = sourceColumns[colIdx]!;
                  const w = colWidths[colIdx] ?? COL_DEFAULT_PX;
                  const kind = colKinds[colIdx] ?? 'string';
                  const isOver = dragOver === visualIdx && dragFrom !== visualIdx;
                  return (
                    <th
                      key={`${colIdx}-${name}`}
                      draggable
                      data-testid="sql-col-header"
                      title={`${name} (${KIND_LABEL[kind]}) — drag to reorder; double-click to fit/reset width; right-click for list variable`}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        onHeaderDoubleClick(colIdx);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ kind: 'column', x: e.clientX, y: e.clientY, colIdx });
                      }}
                      onDragStart={(e) => {
                        setDragFrom(visualIdx);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(visualIdx));
                        if (e.currentTarget instanceof HTMLElement) {
                          e.dataTransfer.setDragImage(e.currentTarget, 12, 12);
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOver !== visualIdx) setDragOver(visualIdx);
                      }}
                      onDragLeave={() => {
                        if (dragOver === visualIdx) setDragOver(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from =
                          dragFrom ?? Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
                        if (Number.isFinite(from)) {
                          setColOrder((prev) =>
                            reorder(
                              prev.length === sourceColumns.length
                                ? prev
                                : identityOrder(sourceColumns.length),
                              from,
                              visualIdx
                            )
                          );
                        }
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      style={{ width: w, minWidth: COL_MIN_PX, maxWidth: w }}
                      className={`relative px-2 py-1.5 font-bold tracking-wide text-left cursor-grab active:cursor-grabbing select-none overflow-hidden ${
                        dragFrom === visualIdx ? 'opacity-50' : ''
                      } ${isOver ? 'bg-slate-300 ring-2 ring-inset ring-cyan-500/60' : ''}`}
                    >
                      <span className="inline-flex items-center gap-1 max-w-full pr-1">
                        <GripVertical className="w-3 h-3 text-slate-400 shrink-0" aria-hidden />
                        <span className="min-w-0 flex flex-col leading-tight">
                          <span className="truncate text-slate-800">{name}</span>
                          <span
                            className={`text-[9px] font-semibold uppercase tracking-wider ${KIND_HEADER_CLASS[kind]}`}
                          >
                            {KIND_LABEL[kind]}
                          </span>
                        </span>
                      </span>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize column ${name}`}
                        data-testid="sql-col-resize"
                        title="Drag to resize column"
                        onMouseDown={(e) => startColResize(colIdx, e)}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onHeaderDoubleClick(colIdx);
                        }}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/50"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="font-mono bg-slate-50">
              {padTop > 0 && (
                <tr aria-hidden style={{ height: padTop }}>
                  <td colSpan={colCount} className="p-0 border-0" />
                </tr>
              )}
              {sourceRows.slice(start, end).map((row, offset) => {
                const i = start + offset;
                const size = pageSize && pageSize > 0 ? pageSize : sourceRows.length;
                const absRow = pageIndex * size + i + 1;
                return (
                  <tr
                    key={i}
                    className="hover:bg-slate-100/90 group border-b border-slate-200"
                    style={{ height: ROW_H_PX }}
                  >
                    <td
                      className="sticky left-0 z-[5] px-1.5 text-center text-[10px] tabular-nums text-slate-500 bg-slate-50 group-hover:bg-slate-100/90 border-r border-slate-200 select-none"
                      style={{ width: ROW_NUM_PX, minWidth: ROW_NUM_PX }}
                      data-testid="sql-row-num"
                    >
                      {absRow}
                    </td>
                    {order.map((colIdx) => {
                      const cell = row[colIdx];
                      const w = colWidths[colIdx] ?? COL_DEFAULT_PX;
                      const { text, title, isNull } = cellDisplay(cell);
                      const kind = isNull ? 'null' : (colKinds[colIdx] ?? 'string');
                      return (
                        <td
                          key={colIdx}
                          className={`px-3 overflow-hidden text-ellipsis ${KIND_CELL_CLASS[kind]}`}
                          style={{ width: w, minWidth: COL_MIN_PX, maxWidth: w }}
                          title={title}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({
                              kind: 'cell',
                              x: e.clientX,
                              y: e.clientY,
                              colIdx,
                              value: cell,
                            });
                          }}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {padBottom > 0 && (
                <tr aria-hidden style={{ height: padBottom }}>
                  <td colSpan={colCount} className="p-0 border-0" />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 shrink-0 flex-wrap">
        <span>
          {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
          {pageSize ? ` / page of ${pageSize}` : ''}
          {typeof pageIndex === 'number' ? ` · page ${pageIndex + 1}` : ''}
          {' · '}
          {result.durationMs} ms
        </span>
        {result.truncated && (
          <span className="text-amber-500 font-semibold">
            truncated — use Next page or raise Rows/page
          </span>
        )}
        {(onPrevPage || onNextPage) && (
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              data-testid="sql-page-prev"
              disabled={!hasPrevPage || pageLoading}
              onClick={onPrevPage}
              className="px-1.5 py-0.5 rounded border border-slate-300 text-slate-600 font-semibold hover:bg-slate-100 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              data-testid="sql-page-next"
              disabled={!hasNextPage || pageLoading}
              onClick={onNextPage}
              className="px-1.5 py-0.5 rounded border border-slate-300 text-slate-600 font-semibold hover:bg-slate-100 disabled:opacity-40"
            >
              {pageLoading ? '…' : 'Next'}
            </button>
          </span>
        )}
      </div>

      {menu && (
        <div
          data-testid="sql-grid-context-menu"
          className="fixed z-50 min-w-[160px] rounded-md border border-slate-700 bg-slate-900 shadow-lg py-1 text-[11px]"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === 'cell' ? (
            <>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-slate-200 hover:bg-slate-800"
                onClick={() => {
                  const colName = sourceColumns[menu.colIdx] ?? 'value';
                  setSavePrompt({
                    mode: 'scalar',
                    value: menu.value,
                    defaultName: colName.replace(/[^A-Za-z0-9_]/g, '_') || 'value',
                  });
                  setMenu(null);
                }}
              >
                Save cell as variable…
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-slate-200 hover:bg-slate-800"
                onClick={() => {
                  setSavePrompt({ mode: 'table', defaultName: 'result' });
                  setMenu(null);
                }}
              >
                Save result as table…
              </button>
            </>
          ) : menu.kind === 'column' ? (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-slate-200 hover:bg-slate-800"
              onClick={() => {
                const colName = sourceColumns[menu.colIdx] ?? 'values';
                setSavePrompt({
                  mode: 'list',
                  colIdx: menu.colIdx,
                  defaultName: `${colName.replace(/[^A-Za-z0-9_]/g, '_') || 'values'}_list`,
                });
                setMenu(null);
              }}
            >
              Save column as list…
            </button>
          ) : (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-slate-200 hover:bg-slate-800"
              onClick={() => {
                setSavePrompt({
                  mode: 'table',
                  defaultName: 'result',
                });
                setMenu(null);
              }}
            >
              Save result as table…
            </button>
          )}
        </div>
      )}

      {savePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          data-testid="sql-variable-save-dialog"
          onClick={() => setSavePrompt(null)}
        >
          <div
            className="w-72 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-semibold text-slate-200 mb-2">
              {savePromptTitle(savePrompt.mode)}
            </div>
            <input
              ref={saveInputRef}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSave();
                if (e.key === 'Escape') setSavePrompt(null);
              }}
              placeholder="variable_name"
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-600/50 mb-2"
            />
            {saveError && (
              <p className="text-[10px] text-rose-400 mb-2" role="alert">
                {saveError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSavePrompt(null)}
                className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="sql-variable-save-confirm"
                onClick={commitSave}
                className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 px-2 py-1"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

DataGrid.displayName = 'DataGrid';

export const PANE_MIN_PX = 240;
export const PANE_DEFAULT_PX = 420;
export const PANE_MIN_H_PX = 160;
export const PANE_DEFAULT_H_PX = 360;
export { ROW_H_PX };
