import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, GripVertical, RefreshCw } from 'lucide-react';
import type { SqlStatementResult } from '../../api/sqlApi';
import { downloadCsv } from '../../utils/exportCsv';

const CELL_MAX = 200;
const COL_MIN_PX = 96;
const COL_DEFAULT_PX = 128;
const COL_MAX_PX = 220;
const COL_LONG_TEXT_PX = 200;
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

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
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

/**
 * Result grid — virtualized rows, column-level type colors (no per-cell regex).
 */
export const DataGrid: React.FC<{
  result: SqlStatementResult;
  label?: string;
  exportName?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}> = React.memo(({ result, label, exportName = 'query-result', refreshing, onRefresh }) => {
  const sourceColumns = result.ok ? result.columns : [];
  const sourceRows = result.ok ? result.rows : [];
  const [colOrder, setColOrder] = useState<number[]>(() => identityOrder(sourceColumns.length));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(320);
  const rafRef = useRef(0);

  const colKey = sourceColumns.join('\0');
  const colWidths = useMemo(
    () => computeColWidths(sourceColumns, sourceRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colKey + rowCount capture result identity cheaply
    [colKey, sourceRows.length, result.ok && result.ok ? result.rowCount : 0]
  );
  const colKinds = useMemo(
    () => computeColKinds(sourceColumns, sourceRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colKey, sourceRows.length, result.ok && result.ok ? result.rowCount : 0]
  );

  useEffect(() => {
    setColOrder(identityOrder(sourceColumns.length));
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

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setScrollTop(el.scrollTop));
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  if (!result.ok) {
    return (
      <div className="w-full min-w-0 flex flex-col">
        <div className="flex items-center gap-2 mb-1 shrink-0">
          {label && (
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate flex-1">
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
        </div>
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
      <div className="flex items-center gap-2 mb-1 shrink-0">
        {label && (
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate flex-1" title={label}>
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
        {sourceColumns.length > 0 && (
          <button
            type="button"
            title="Export CSV"
            onClick={exportOrdered}
            className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-cyan-400 transition shrink-0"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        data-testid="sql-data-grid"
        className="fox-sql-grid flex-1 min-h-0 border border-[#cbd5e1] rounded-lg shadow-sm bg-white"
        style={{ overflowX: 'auto', overflowY: 'auto' }}
        onScroll={onScroll}
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
              <tr className="bg-[#e2e8f0] border-b border-[#cbd5e1] text-[#0f172a]">
                <th
                  className="sticky left-0 z-20 px-1.5 py-1.5 text-center font-bold text-[#64748b] bg-[#e2e8f0] border-r border-[#cbd5e1] select-none"
                  style={{ width: ROW_NUM_PX, minWidth: ROW_NUM_PX }}
                  title="Row number"
                  aria-label="Row number"
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
                      title={`${name} (${KIND_LABEL[kind]}) — drag to reorder`}
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
                      className={`px-2 py-1.5 font-bold tracking-wide text-left cursor-grab active:cursor-grabbing select-none overflow-hidden ${
                        dragFrom === visualIdx ? 'opacity-50' : ''
                      } ${isOver ? 'bg-[#cbd5e1] ring-2 ring-inset ring-cyan-500/70' : ''}`}
                    >
                      <span className="inline-flex items-center gap-1 max-w-full">
                        <GripVertical className="w-3 h-3 text-[#94a3b8] shrink-0" aria-hidden />
                        <span className="min-w-0 flex flex-col leading-tight">
                          <span className="truncate text-[#0f172a]">{name}</span>
                          <span
                            className={`text-[9px] font-semibold uppercase tracking-wider ${KIND_HEADER_CLASS[kind]}`}
                          >
                            {KIND_LABEL[kind]}
                          </span>
                        </span>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="font-mono bg-white">
              {padTop > 0 && (
                <tr aria-hidden style={{ height: padTop }}>
                  <td colSpan={colCount} className="p-0 border-0" />
                </tr>
              )}
              {sourceRows.slice(start, end).map((row, offset) => {
                const i = start + offset;
                return (
                  <tr
                    key={i}
                    className="hover:bg-[#f1f5f9] group border-b border-[#e2e8f0]"
                    style={{ height: ROW_H_PX }}
                  >
                    <td
                      className="sticky left-0 z-[5] px-1.5 text-center text-[10px] tabular-nums text-[#64748b] bg-white group-hover:bg-[#f1f5f9] border-r border-[#e2e8f0] select-none"
                      style={{ width: ROW_NUM_PX, minWidth: ROW_NUM_PX }}
                      data-testid="sql-row-num"
                    >
                      {i + 1}
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
      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 shrink-0">
        <span>
          {result.rowCount} row{result.rowCount === 1 ? '' : 's'} · {result.durationMs} ms
        </span>
        {result.truncated && (
          <span className="text-amber-500 font-semibold">truncated — add a LIMIT for the full picture</span>
        )}
      </div>
    </div>
  );
});

DataGrid.displayName = 'DataGrid';

export const PANE_MIN_PX = 240;
export const PANE_DEFAULT_PX = 420;
