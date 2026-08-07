/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Results for one SQL Editor tab (By cred / Side-by-side layouts).
 * Side-by-side can Compare cell values across credentials (colored diffs).
 * Foreign-key cells can open Data Peek when schema FKs match the statement.
 * Single-table SELECT grids support add / edit / clone / delete (same DML path
 * as Data Peek) when the primary key is present in the result columns.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Database, AlertCircle, GripVertical, RefreshCw, GitCompare } from 'lucide-react';
import { useSqlEditorStore, type CredentialRun } from '../../store/useSqlEditorStore';
import { useSyncStore } from '../../store/useSyncStore';
import type { ResultsLayout } from '../../store/sqlEditorTabLogic';
import { DataGrid, PANE_DEFAULT_H_PX, PANE_DEFAULT_PX, PANE_MIN_H_PX, PANE_MIN_PX } from './DataGrid';
import type { SqlStatementResult } from '../../api/sqlApi';
import { detectCodeCell } from '../../lib/codeCellRunner';
import { CODE_CELL_KIND_LABEL } from '../../lib/sql-splitter';
import { foreignKeyLinksFor, foreignKeyLinksForSql, singleTableForResultEdit } from '../../lib/tablePreview';
import {
  cellDiffKey,
  compareResultGrids,
  type CellDiffKind,
  type GridDiffSummary,
} from '../../lib/resultDataDiff';
import { detectTriggerManagedColumns } from '../../lib/triggerManagedColumns';
import { buildSampleBookmarks } from '../../lib/sqlEditorSamples';
import { DataMigrateBar } from './DataMigrateBar';
import { usePeekGridCrud } from './usePeekGridCrud';
import { SQL_ICON_STROKE } from './sqlIconStyle';

interface Props {
  runs: CredentialRun[];
  /** The statements the run executed, for grid labels ("Query 1 · SELECT …"). */
  statements: string[];
  /** 0-based source cell indices aligned with `statements` (for Out [n]). */
  statementIndices?: number[];
  layout: ResultsLayout;
  /** True while any execute is in flight for this tab. */
  refreshing?: boolean;
  /** Non-fatal run messages (e.g. `@set` failures). */
  warnings?: string[];
  /** Re-run for one credential, or all when omitted. */
  onRefresh?: (connectionId?: string) => void;
  /** Load another result page for a grid (server OFFSET; uses page cache). */
  onPage?: (args: {
    connectionId: string;
    statementIndex: number;
    pageIndex: number;
  }) => void;
  pageState?: Record<
    string,
    { pageIndex: number; hasNext: boolean; loading?: boolean; pageSize?: number }
  >;
}

const GAP_PX = 6; // space between pane and its resize grip

/** Attach document-level drag listeners; cleans up cursor/userSelect on mouseup. */
function bindAxisDrag(cursor: string, onMove: (ev: MouseEvent) => void): void {
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  document.body.style.cursor = cursor;
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

const statementLabel = (sql: string, outNumber: number): string => {
  const cell = detectCodeCell(sql);
  if (cell) {
    return `Out [${outNumber}]: ${CODE_CELL_KIND_LABEL[cell.kind].long}`;
  }
  const compact = sql.replace(/\s+/g, ' ').trim();
  return `Out [${outNumber}]: ${compact.length > 48 ? compact.slice(0, 48) + '…' : compact}`;
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
      dialect: string;
      statementIndex: number;
      /** SQL that produced this grid — used for FK → Data Peek links + row edit. */
      statementSql?: string;
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

const ResultGridPane: React.FC<{
  item: Extract<PaneItem, { kind: 'grid' }>;
  refreshing?: boolean;
  onRefresh?: (connectionId: string) => void;
  onPage?: Props['onPage'];
  pageState?: Props['pageState'];
  syncScrollRow?: number | null;
  onSyncScrollRow?: (row: number | null) => void;
  /** Cross-connection compare highlights for this grid. */
  diffSummary?: GridDiffSummary | null;
  /** Suffix shown after the grid label (e.g. baseline / N differ). */
  compareBadge?: string | null;
}> = ({
  item,
  refreshing,
  onRefresh,
  onPage,
  pageState,
  syncScrollRow = null,
  onSyncScrollRow,
  diffSummary = null,
  compareBadge = null,
}) => {
  const schemaCache = useSqlEditorStore((s) => s.schemaCache);
  const openDataPeekFromFk = useSqlEditorStore((s) => s.openDataPeekFromFk);
  const connectionSchema = useSyncStore(
    (s) => s.connections.find((c) => c.id === item.connectionId)?.schema
  );
  const tables = schemaCache[item.connectionId]?.tables;

  const editTarget = useMemo(() => {
    if (!item.statementSql || detectCodeCell(item.statementSql)) {
      return { ok: false as const, reason: undefined as string | undefined };
    }
    return singleTableForResultEdit(item.statementSql, tables, connectionSchema);
  }, [item.statementSql, tables, connectionSchema]);

  const table = editTarget.ok ? editTarget.table : undefined;
  // Prefer the schema cache name (same as Data Peek entry.tableName from the explorer).
  const tableName = table?.name ?? '';

  // Match Data Peek: FK links come from the single editable table when known.
  const fkLinks = useMemo(() => {
    if (!item.result.ok) return [];
    if (table) return foreignKeyLinksFor(table, item.result.columns);
    if (!item.statementSql) return [];
    return foreignKeyLinksForSql(item.statementSql, tables, item.result.columns);
  }, [item.result, item.statementSql, table, tables]);

  const linkColumns = useMemo(() => {
    if (fkLinks.length === 0) return undefined;
    const map = new Map<number, string>();
    for (const l of fkLinks) map.set(l.columnIndex, l.fk.referencedTable);
    return map;
  }, [fkLinks]);

  const onLinkClick = useCallback(
    (colIdx: number, rowIdx: number) => {
      if (!item.result.ok) return;
      const link = fkLinks.find((l) => l.columnIndex === colIdx);
      if (!link) return;
      const row = item.result.rows[rowIdx];
      if (!row) return;
      void openDataPeekFromFk(
        item.connectionId,
        link.fk,
        link.valueIndexes.map((i) => row[i])
      );
    },
    [item, fkLinks, openDataPeekFromFk]
  );

  const pageKey = `${item.connectionId}:${item.statementIndex}`;
  const page = pageState?.[pageKey];
  const pageIndex = page?.pageIndex ?? 0;

  const afterWrite = useCallback(async () => {
    // Same idea as Data Peek's runDataPeekEntry: refresh only this grid's page.
    const store = useSqlEditorStore.getState();
    const tab = store.resultsByTab[store.activeTabId];
    const sql = tab?.pageSqlByConnection?.[item.connectionId]?.[item.statementIndex];
    if (sql) {
      await store.reloadResultPage({
        connectionId: item.connectionId,
        statementIndex: item.statementIndex,
        pageIndex,
      });
      return;
    }
    // Fallback when paging SQL was not recorded (non-pageable / empty).
    onRefresh?.(item.connectionId);
  }, [item.connectionId, item.statementIndex, pageIndex, onRefresh]);

  const columns = item.result.ok ? item.result.columns : [];
  const rows = item.result.ok ? item.result.rows : [];

  const crud = usePeekGridCrud({
    connectionId: item.connectionId,
    dialect: item.dialect,
    tableName,
    table,
    columns,
    rows,
    // Match Data Peek: resultOk is about the grid, not whether schema resolved yet.
    resultOk: Boolean(item.result.ok),
    sessionKey: `${item.connectionId}:${item.statementIndex}:${pageIndex}`,
    resultEpoch: item.result,
    onAfterWrite: afterWrite,
    testId: (action) => `sql-result-${item.statementIndex}-${action}`,
  });

  const readOnlyReason =
    !crud.showCrud && item.result.ok
      ? (!editTarget.ok ? editTarget.reason : crud.editability.reason)
      : undefined;

  const toolbarExtra = (
    <>
      {crud.crudButtons}
      {readOnlyReason && (
        <span
          className="text-xs font-semibold text-slate-400 truncate max-w-[14rem]"
          title={readOnlyReason}
          data-testid={`sql-result-${item.statementIndex}-readonly`}
        >
          Read-only
        </span>
      )}
    </>
  );

  const cellHighlight = useMemo(() => {
    if (!diffSummary || diffSummary.cells.size === 0) return undefined;
    const cells = diffSummary.cells;
    return (rowIdx: number, colIdx: number): CellDiffKind | null =>
      cells.get(cellDiffKey(rowIdx, colIdx)) ?? null;
  }, [diffSummary]);

  const gridLabel = compareBadge ? `${item.label} · ${compareBadge}` : item.label;

  return (
    <div className="flex flex-col min-h-0 h-full">
      {crud.writeErrorBanner}
      <DataGrid
        result={item.result}
        label={gridLabel}
        exportName={item.exportName}
        refreshing={refreshing}
        onRefresh={onRefresh ? () => onRefresh(item.connectionId) : undefined}
        syncScrollRow={onSyncScrollRow ? syncScrollRow : null}
        onSyncScrollRow={onSyncScrollRow}
        pageIndex={pageIndex}
        pageSize={page?.pageSize}
        hasPrevPage={!refreshing && Boolean(page) && pageIndex > 0}
        hasNextPage={!refreshing && Boolean(page?.hasNext)}
        pageLoading={Boolean(refreshing || page?.loading)}
        onPrevPage={
          onPage && page && !refreshing
            ? () =>
                onPage({
                  connectionId: item.connectionId,
                  statementIndex: item.statementIndex,
                  pageIndex: Math.max(0, pageIndex - 1),
                })
            : undefined
        }
        onNextPage={
          onPage && page && !refreshing
            ? () =>
                onPage({
                  connectionId: item.connectionId,
                  statementIndex: item.statementIndex,
                  pageIndex: pageIndex + 1,
                })
            : undefined
        }
        linkColumns={linkColumns}
        onLinkClick={linkColumns ? onLinkClick : undefined}
        selectedRowIndex={crud.selectedRowIndex}
        onSelectRow={crud.onSelectRow}
        toolbarExtra={toolbarExtra}
        cellHighlight={cellHighlight}
      />
      {linkColumns && linkColumns.size > 0 && (
        <p
          className="mt-0.5 px-0.5 shrink-0 text-[10px] text-slate-500"
          data-testid="sql-results-fk-hint"
        >
          Underlined rust cells are foreign keys — click one to open Data Peek (related rows).
        </p>
      )}
      {crud.overlays}
    </div>
  );
};

const PaneBody: React.FC<{
  item: PaneItem;
  refreshing?: boolean;
  onRefresh?: (connectionId: string) => void;
  onPage?: Props['onPage'];
  pageState?: Props['pageState'];
  syncScrollRow?: number | null;
  onSyncScrollRow?: (row: number | null) => void;
  diffSummary?: GridDiffSummary | null;
  compareBadge?: string | null;
}> = ({
  item,
  refreshing,
  onRefresh,
  onPage,
  pageState,
  syncScrollRow = null,
  onSyncScrollRow,
  diffSummary = null,
  compareBadge = null,
}) => {
  if (item.kind === 'grid') {
    return (
      <ResultGridPane
        item={item}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onPage={onPage}
        pageState={pageState}
        syncScrollRow={syncScrollRow}
        onSyncScrollRow={onSyncScrollRow}
        diffSummary={diffSummary}
        compareBadge={compareBadge}
      />
    );
  }
  if (item.kind === 'running') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 h-full px-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" strokeWidth={SQL_ICON_STROKE} />{' '}
        {item.label}
      </div>
    );
  }
  return (
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
            <RefreshCw
              className={`w-3 h-3 text-cyan-400 ${refreshing ? 'animate-spin' : ''}`}
              strokeWidth={SQL_ICON_STROKE}
            />{' '}
            Refresh
          </button>
        )}
      </div>
      <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2 flex-1 overflow-auto">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" strokeWidth={SQL_ICON_STROKE} />
        <span className="break-all">{item.error}</span>
      </div>
    </div>
  );
};

/**
 * Horizontal row of result panes (side-by-side layout). Every table has its own
 * drag grip on the right edge — widths are independent.
 */
const ResizablePaneRow: React.FC<{
  items: PaneItem[];
  rowKey: string;
  refreshing?: boolean;
  onRefresh?: (connectionId: string) => void;
  onPage?: Props['onPage'];
  pageState?: Props['pageState'];
  /** Per connectionId: cell diff summary when Compare is on. */
  diffByConnection?: Record<string, GridDiffSummary>;
  /** Per connectionId: label badge (baseline / N differ). */
  badgeByConnection?: Record<string, string>;
}> = ({
  items,
  rowKey,
  refreshing,
  onRefresh,
  onPage,
  pageState,
  diffByConnection,
  badgeByConnection,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>(() => items.map(() => PANE_DEFAULT_PX));
  const [rowHeight, setRowHeight] = useState(PANE_DEFAULT_H_PX);
  const [syncRow, setSyncRow] = useState<number | null>(null);
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
      setSyncRow(null);
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
    bindAxisDrag('col-resize', (ev) => {
      const next = Math.max(PANE_MIN_PX, startW + (ev.clientX - startX));
      setWidths((prev) => {
        if (prev[index] === next) return prev;
        const copy = [...prev];
        copy[index] = next;
        return copy;
      });
    });
  }, [widths]);

  const startRowHeightResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = rowHeight;
      bindAxisDrag('row-resize', (ev) => {
        setRowHeight(Math.max(PANE_MIN_H_PX, startH + (ev.clientY - startY)));
      });
    },
    [rowHeight]
  );

  if (items.length === 0) return null;

  const syncScroll = items.filter((x) => x.kind === 'grid').length > 1;

  return (
    <div className="flex flex-col min-w-0" data-testid="sql-result-pane-row-wrap">
      <div
        ref={rowRef}
        className="flex overflow-x-auto overflow-y-hidden items-stretch pb-1 gap-0"
        style={{ height: rowHeight, minHeight: PANE_MIN_H_PX }}
        data-testid="sql-result-pane-row"
      >
        {items.map((item, i) => (
          <React.Fragment key={item.key}>
            <div
              className="flex flex-col min-h-0 shrink-0"
              style={{ width: widths[i] ?? PANE_DEFAULT_PX, minWidth: PANE_MIN_PX }}
            >
              <PaneBody
                item={item}
                refreshing={refreshing}
                onRefresh={onRefresh}
                onPage={onPage}
                pageState={pageState}
                syncScrollRow={syncScroll ? syncRow : null}
                onSyncScrollRow={syncScroll ? setSyncRow : undefined}
                diffSummary={diffByConnection?.[item.connectionId] ?? null}
                compareBadge={badgeByConnection?.[item.connectionId] ?? null}
              />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize table ${i + 1}`}
              data-testid="sql-pane-resize"
              title="Drag to resize this table"
              onMouseDown={(e) => startPaneResize(i, e)}
              className="w-2 shrink-0 cursor-col-resize self-stretch mx-0.5 rounded-sm bg-slate-800 hover:bg-cyan-600/70 active:bg-cyan-500 flex items-center justify-center group"
            >
              <GripVertical
                className="w-3 h-3 text-cyan-400 group-hover:text-cyan-200 pointer-events-none"
                strokeWidth={SQL_ICON_STROKE}
              />
            </div>
          </React.Fragment>
        ))}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize result row height"
        data-testid="sql-result-row-height-resize"
        title="Drag to resize result grid height"
        onMouseDown={startRowHeightResize}
        className="h-1.5 shrink-0 cursor-row-resize bg-slate-800 hover:bg-cyan-500/40 active:bg-cyan-500/60 transition-colors rounded-sm"
      />
    </div>
  );
};

/**
 * Vertical stack of full-width result panes (By cred layout). Each statement
 * gets its own height grip — no horizontal side-by-side.
 */
const StackedPaneColumn: React.FC<{
  items: PaneItem[];
  refreshing?: boolean;
  onRefresh?: (connectionId: string) => void;
  onPage?: Props['onPage'];
  pageState?: Props['pageState'];
}> = ({ items, refreshing, onRefresh, onPage, pageState }) => {
  const [heights, setHeights] = useState<number[]>(() => items.map(() => PANE_DEFAULT_H_PX));

  useEffect(() => {
    setHeights((prev) => {
      if (prev.length === items.length) return prev;
      if (prev.length < items.length) {
        return [
          ...prev,
          ...Array.from({ length: items.length - prev.length }, () => PANE_DEFAULT_H_PX),
        ];
      }
      return prev.slice(0, items.length);
    });
  }, [items.length]);

  const startHeightResize = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = heights[index] ?? PANE_DEFAULT_H_PX;
    bindAxisDrag('row-resize', (ev) => {
      const next = Math.max(PANE_MIN_H_PX, startH + (ev.clientY - startY));
      setHeights((prev) => {
        if (prev[index] === next) return prev;
        const copy = [...prev];
        copy[index] = next;
        return copy;
      });
    });
  }, [heights]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 min-w-0" data-testid="sql-result-pane-stack">
      {items.map((item, i) => (
        <div key={item.key} className="flex flex-col min-w-0" data-testid={`sql-result-stack-item-${i}`}>
          <div
            className="flex flex-col min-h-0 min-w-0"
            style={{ height: heights[i] ?? PANE_DEFAULT_H_PX, minHeight: PANE_MIN_H_PX }}
          >
            <PaneBody
              item={item}
              refreshing={refreshing}
              onRefresh={onRefresh}
              onPage={onPage}
              pageState={pageState}
            />
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize Out table ${i + 1} height`}
            data-testid="sql-result-stack-height-resize"
            title="Drag to resize this result height"
            onMouseDown={(e) => startHeightResize(i, e)}
            className="h-1.5 shrink-0 cursor-row-resize bg-slate-800 hover:bg-cyan-500/40 active:bg-cyan-500/60 transition-colors rounded-sm mt-1"
          />
        </div>
      ))}
    </div>
  );
};

/**
 * One statement row in side-by-side layout, with optional cross-connection
 * data compare (cell colors vs a baseline credential).
 */
const SideBySideStatementSection: React.FC<{
  statementIndex: number;
  outTestId: number;
  headerLabel: string;
  items: PaneItem[];
  refreshing?: boolean;
  onRefresh?: (connectionId?: string) => void;
  onPage?: Props['onPage'];
  pageState?: Props['pageState'];
}> = ({
  statementIndex,
  outTestId,
  headerLabel,
  items,
  refreshing,
  onRefresh,
  onPage,
  pageState,
}) => {
  const okGrids = useMemo(
    () =>
      items.filter(
        (x): x is Extract<PaneItem, { kind: 'grid' }> => x.kind === 'grid' && Boolean(x.result.ok)
      ),
    [items]
  );
  const canCompare = okGrids.length >= 2;
  /** Off by default — side-by-side shows plain grids until the user opts into Compare. */
  const [compareOn, setCompareOn] = useState(false);
  /** Skip createdAt / updatedBy / etc. — values differ across DBs even when rows match. */
  const [skipTriggerCols, setSkipTriggerCols] = useState(true);
  const [baselineId, setBaselineId] = useState<string>('');

  useEffect(() => {
    if (!canCompare) return;
    if (!baselineId || !okGrids.some((g) => g.connectionId === baselineId)) {
      setBaselineId(okGrids[0]!.connectionId);
    }
  }, [canCompare, okGrids, baselineId]);

  const compareActive = canCompare && compareOn && Boolean(baselineId);

  const triggerIgnoreColumns = useMemo(() => {
    if (!skipTriggerCols) return [] as string[];
    const names = new Set<string>();
    for (const g of okGrids) {
      if (!g.result.ok) continue;
      for (const c of detectTriggerManagedColumns(g.result.columns)) names.add(c);
    }
    return [...names];
  }, [skipTriggerCols, okGrids]);

  const { diffByConnection, badgeByConnection, legendBits } = useMemo(() => {
    const diffByConnection: Record<string, GridDiffSummary> = {};
    const badgeByConnection: Record<string, string> = {};
    const legendBits: string[] = [];
    if (!compareActive) {
      return { diffByConnection, badgeByConnection, legendBits };
    }
    const baselineItem = okGrids.find((g) => g.connectionId === baselineId);
    if (!baselineItem || !baselineItem.result.ok) {
      return { diffByConnection, badgeByConnection, legendBits };
    }
    const baselineGrid = {
      columns: baselineItem.result.columns,
      rows: baselineItem.result.rows,
    };
    badgeByConnection[baselineId] = 'baseline';

    let totalModified = 0;
    let totalMissing = 0;
    let totalExtra = 0;
    const missingCols = new Set<string>();
    const extraCols = new Set<string>();
    const ignoreOpts =
      triggerIgnoreColumns.length > 0
        ? { ignoreColumns: triggerIgnoreColumns }
        : undefined;

    for (const g of okGrids) {
      if (g.connectionId === baselineId || !g.result.ok) continue;
      const pair = compareResultGrids(
        baselineGrid,
        {
          columns: g.result.columns,
          rows: g.result.rows,
        },
        ignoreOpts
      );
      // Merge baseline highlights across all others (union of diffs).
      const prev = diffByConnection[baselineId];
      if (!prev) {
        diffByConnection[baselineId] = pair.baseline;
      } else {
        for (const [k, kind] of pair.baseline.cells) {
          if (!prev.cells.has(k)) {
            prev.cells.set(k, kind);
            if (kind === 'modified') prev.modified += 1;
            else if (kind === 'missing') prev.missing += 1;
            else prev.extra += 1;
          }
        }
        for (const c of pair.baseline.missingColumns) {
          if (!prev.missingColumns.includes(c)) prev.missingColumns.push(c);
        }
        for (const c of pair.baseline.extraColumns) {
          if (!prev.extraColumns.includes(c)) prev.extraColumns.push(c);
        }
      }
      diffByConnection[g.connectionId] = pair.other;
      const n = pair.other.cells.size;
      badgeByConnection[g.connectionId] = n === 0 ? 'match' : `${n} differ`;
      totalModified += pair.other.modified;
      totalMissing += pair.other.missing + pair.baseline.missing;
      totalExtra += pair.other.extra;
      for (const c of pair.other.missingColumns) missingCols.add(c);
      for (const c of pair.other.extraColumns) extraCols.add(c);
    }

    const baseCells = diffByConnection[baselineId]?.cells.size ?? 0;
    badgeByConnection[baselineId] =
      baseCells === 0 ? 'baseline' : `baseline · ${baseCells} differ`;

    if (totalModified > 0) legendBits.push(`${totalModified} modified`);
    if (totalMissing > 0) legendBits.push(`${totalMissing} missing`);
    if (totalExtra > 0) legendBits.push(`${totalExtra} extra`);
    if (missingCols.size > 0) {
      legendBits.push(`cols only in baseline: ${[...missingCols].join(', ')}`);
    }
    if (extraCols.size > 0) {
      legendBits.push(`cols only in other: ${[...extraCols].join(', ')}`);
    }
    if (triggerIgnoreColumns.length > 0) {
      legendBits.push(`skipping ${triggerIgnoreColumns.join(', ')}`);
    }
    if (legendBits.length === 0) legendBits.push('grids match on this page');

    return { diffByConnection, badgeByConnection, legendBits };
  }, [compareActive, okGrids, baselineId, triggerIgnoreColumns]);

  const [destId, setDestId] = useState<string>('');
  useEffect(() => {
    if (!compareActive) return;
    const others = okGrids.filter((g) => g.connectionId !== baselineId);
    if (!destId || !others.some((g) => g.connectionId === destId)) {
      setDestId(others[0]?.connectionId ?? '');
    }
  }, [compareActive, okGrids, baselineId, destId]);

  const sourceGrid = okGrids.find((g) => g.connectionId === baselineId);
  const destGrid = okGrids.find((g) => g.connectionId === destId);

  const insertServerBeamSample = () => {
    const sample = buildSampleBookmarks().find((b) => b.id === 'sample-server-beam-chunked');
    if (!sample) return;
    useSqlEditorStore.getState().setSql(sample.sql);
  };

  return (
    <section
      className="flex flex-col gap-2 min-w-0"
      data-testid={`sql-result-stmt-${outTestId}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0">
        <div className="text-xs font-bold text-slate-200 font-mono tracking-tight min-w-0 truncate">
          {headerLabel}
        </div>
        {canCompare && (
          <div
            className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-400"
            data-testid={`sql-result-compare-toolbar-${statementIndex}`}
          >
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid={`sql-result-compare-toggle-${statementIndex}`}
                checked={compareOn}
                onChange={(e) => setCompareOn(e.target.checked)}
                className="rounded border-slate-600"
              />
              <GitCompare className="w-3 h-3 text-sky-400" strokeWidth={SQL_ICON_STROKE} />
              Compare data
            </label>
            {!compareOn && (
              <span className="text-slate-600 font-medium">
                Turn on to highlight diffs and choose Add / Edit / Delete
              </span>
            )}
            {compareOn && (
              <label className="flex items-center gap-1">
                <span className="text-slate-500">source</span>
                <select
                  data-testid={`sql-result-compare-baseline-${statementIndex}`}
                  value={baselineId}
                  onChange={(e) => setBaselineId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200 max-w-[12rem]"
                >
                  {okGrids.map((g) => (
                    <option key={g.connectionId} value={g.connectionId}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {compareOn && (
              <label
                className="flex items-center gap-1 cursor-pointer select-none"
                title="Ignore trigger/audit columns (createdAt, updatedBy, …) in Compare highlights and Data migrate. Destinations often fill these differently."
              >
                <input
                  type="checkbox"
                  data-testid={`sql-result-compare-skip-trigger-${statementIndex}`}
                  checked={skipTriggerCols}
                  onChange={(e) => setSkipTriggerCols(e.target.checked)}
                  className="rounded border-slate-600"
                />
                Skip trigger cols
              </label>
            )}
            {compareActive && okGrids.length > 2 && (
              <label className="flex items-center gap-1">
                <span className="text-slate-500">dest</span>
                <select
                  data-testid={`sql-result-compare-dest-${statementIndex}`}
                  value={destId}
                  onChange={(e) => setDestId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200 max-w-[12rem]"
                >
                  {okGrids
                    .filter((g) => g.connectionId !== baselineId)
                    .map((g) => (
                      <option key={g.connectionId} value={g.connectionId}>
                        {g.label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {compareActive && (
              <span
                className="flex items-center gap-2 text-[10px] font-medium text-slate-500"
                data-testid={`sql-result-compare-legend-${statementIndex}`}
              >
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-amber-500/70" /> modified
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-rose-500/70" /> missing
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> extra
                </span>
                <span className="text-slate-600 truncate max-w-[20rem]" title={legendBits.join(' · ')}>
                  {legendBits.join(' · ')}
                </span>
              </span>
            )}
          </div>
        )}
      </header>
      {compareActive && sourceGrid?.result.ok && destGrid?.result.ok && (
        <DataMigrateBar
          statementIndex={statementIndex}
          source={{
            connectionId: sourceGrid.connectionId,
            dialect: sourceGrid.dialect,
            label: sourceGrid.label,
            columns: sourceGrid.result.columns,
            rows: sourceGrid.result.rows,
            statementSql: sourceGrid.statementSql,
            pageIndex:
              pageState?.[`${sourceGrid.connectionId}:${statementIndex}`]?.pageIndex ?? 0,
            hasMore: Boolean(
              sourceGrid.result.hasNext || sourceGrid.result.truncated
            ),
          }}
          dest={{
            connectionId: destGrid.connectionId,
            dialect: destGrid.dialect,
            label: destGrid.label,
            columns: destGrid.result.columns,
            rows: destGrid.result.rows,
            statementSql: destGrid.statementSql,
            pageIndex:
              pageState?.[`${destGrid.connectionId}:${statementIndex}`]?.pageIndex ?? 0,
            hasMore: Boolean(destGrid.result.hasNext || destGrid.result.truncated),
          }}
          ignoreColumns={triggerIgnoreColumns}
          onAfterMigrate={() => onRefresh?.(destGrid.connectionId)}
          onOpenServerBeamSample={insertServerBeamSample}
        />
      )}
      <ResizablePaneRow
        items={items}
        rowKey={`side-${statementIndex}-${items.map((x) => x.key).join('|')}`}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onPage={onPage}
        pageState={pageState}
        diffByConnection={compareActive ? diffByConnection : undefined}
        badgeByConnection={compareActive ? badgeByConnection : undefined}
      />
      {compareActive && (
        <p className="text-[10px] text-slate-500 px-0.5" data-testid={`sql-result-compare-hint-${statementIndex}`}>
          Cell colors align by row index. Migrate matches rows by PK/unique keys and only runs when
          both grids show the full result on page 1. Choose Add / Edit / Delete yourself; Transaction
          and Stop / Continue are safety assists. Skip trigger cols ignores createdAt / updatedBy.
          Cap: 500 ops — larger sets use Server Beam.
        </p>
      )}
    </section>
  );
};

/**
 * Results for one tab. `byCredential` stacks credentials, and statement grids
 * under each credential are also stacked vertically (not side by side).
 * `sideBySide` stacks statements with credential grids as columns.
 */
export const ResultsPanel: React.FC<Props> = ({
  runs,
  statements,
  statementIndices,
  layout,
  refreshing,
  warnings,
  onRefresh,
  onPage,
  pageState,
}) => {
  const outNumber = (i: number) => (statementIndices?.[i] ?? i) + 1;
  const outTestId = (i: number) => statementIndices?.[i] ?? i;
  if (runs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-xs gap-2 px-6 text-center">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-sky-400" strokeWidth={SQL_ICON_STROKE} />
          Run a query to see results here — one section per checked credential.
        </div>
        <p className="max-w-md text-[11px] text-slate-500 leading-relaxed" data-testid="sql-results-peek-instruction">
          Tip: after Run, single-table SELECT grids can edit rows (when the key columns are in the result).
          Underlined rust foreign-key cells open <span className="text-slate-400">Data Peek</span>.
          Or Cmd/Ctrl-click a table in Schema to peek without writing SQL.
        </p>
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
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" strokeWidth={SQL_ICON_STROKE} />
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
              dialect: run.dialect,
              statementIndex: i,
              statementSql: statements[i],
            });
          }
          return (
            <SideBySideStatementSection
              key={i}
              statementIndex={i}
              outTestId={outTestId(i)}
              headerLabel={statementLabel(statements[i] ?? '', outNumber(i))}
              items={items}
              refreshing={refreshing}
              onRefresh={onRefresh}
              onPage={onPage}
              pageState={pageState}
            />
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
                label: statementLabel(statements[i] ?? '', outNumber(i)),
                exportName: `${run.name}-q${i + 1}`,
                connectionId: run.connectionId,
                dialect: run.dialect,
                statementIndex: i,
                statementSql: statements[i],
              }))
            : [];

        return (
          <section key={run.connectionId} className="flex flex-col gap-2 min-w-0">
            <header className="flex items-center gap-2 text-xs font-bold text-slate-200 shrink-0">
              <Database className="w-3.5 h-3.5 text-sky-400" strokeWidth={SQL_ICON_STROKE} />
              {run.name}
              <span className="text-[10px] font-semibold text-slate-500 uppercase">[{run.dialect}]</span>
              {run.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" strokeWidth={SQL_ICON_STROKE} />}
              {onRefresh && run.status !== 'running' && (
                <button
                  type="button"
                  data-testid="sql-cred-refresh"
                  title="Refresh this server"
                  disabled={refreshing}
                  onClick={() => onRefresh(run.connectionId)}
                  className="ml-auto flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-cyan-400 transition disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 text-cyan-400 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={SQL_ICON_STROKE} /> Refresh
                </button>
              )}
            </header>

            {run.status === 'error' && (
              <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2 max-w-2xl">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" strokeWidth={SQL_ICON_STROKE} />
                <span className="break-all">{run.error}</span>
              </div>
            )}

            {run.status === 'done' && items.length > 0 && (
              <StackedPaneColumn
                items={items}
                refreshing={refreshing}
                onRefresh={onRefresh}
                onPage={onPage}
                pageState={pageState}
              />
            )}
          </section>
        );
      })}
      </div>
    </div>
  );
};
