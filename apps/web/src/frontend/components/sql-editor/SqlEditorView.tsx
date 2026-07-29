import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Play,
  Eraser,
  AlignLeft,
  Columns2,
  Rows3,
  RefreshCw,
  BookmarkPlus,
  Database,
  Bookmark,
  Network,
  Shield,
  Braces,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import { useSyncStore } from '../../store/useSyncStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { splitSqlStatements, type SplitStatement } from '../../lib/sql-splitter';
import { formatEditorSql } from '../../utils/formatSql';
import { effectiveConnectionIds, canExecuteWithoutDestination, resolveRunStatements } from '../../store/sqlEditorTabLogic';
import { getSelectedSql, setCompletionContextGetter } from './sqlEditorBridge';
import { ConnectionChecklist } from './ConnectionChecklist';
import { EditorTabBar } from './EditorTabBar';
import { ResultsPanel } from './ResultsPanel';
import { DataPeekPanel } from './DataPeekPanel';
import { StatementStrip } from './StatementStrip';
import { SqlBookmarksPanel } from './SqlBookmarksPanel';
import { SqlVariablesPanel } from './SqlVariablesPanel';
import { SqlSecretsPanel, type SqlSecretsPanelHandle } from './SqlSecretsPanel';
import { SQL_ICON_STROKE } from './sqlIconStyle';
import { SqlSchemaExplorer, type SqlSchemaExplorerHandle } from './SqlSchemaExplorer';
import {
  SqlSidebarSection,
  useSidebarSectionHeights,
  useSidebarSectionsOpen,
} from './SqlSidebarSection';
import { WriteConfirmDialog } from './WriteConfirmDialog';
import type { RevealRequest } from './SqlEditorPane';

const SqlEditorPane = lazy(() => import('./SqlEditorPane'));

const EditorFallback: React.FC = () => (
  <div className="flex-1 flex items-center justify-center text-slate-600">
    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" strokeWidth={SQL_ICON_STROKE} />
  </div>
);

const EDITOR_PCT_MIN = 15;
const EDITOR_PCT_MAX = 70;
const EDITOR_PCT_DEFAULT = 26;

const SIDEBAR_WIDTH_KEY = 'foxschema-sql-sidebar-width';
const SIDEBAR_COLLAPSED_KEY = 'foxschema-sql-sidebar-collapsed';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 288;

function loadSidebarWidth(): number {
  try {
    const n = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(n)) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  } catch {
    /* ignore */
  }
  return SIDEBAR_DEFAULT;
}

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * SQL Editor workspace: multi-tab buffers, destination servers, schema explorer,
 * statement strip, layout toggle, Format/CSV. Results are per-tab and not persisted.
 */
export const SqlEditorView: React.FC = () => {
  const connections = useSyncStore((s) => s.connections);
  const tabs = useSqlEditorStore((s) => s.tabs);
  const activeTabId = useSqlEditorStore((s) => s.activeTabId);
  const resultsByTab = useSqlEditorStore((s) => s.resultsByTab);
  const runningTabId = useSqlEditorStore((s) => s.runningTabId);
  const pendingWriteConfirm = useSqlEditorStore((s) => s.pendingWriteConfirm);
  const schemaCache = useSqlEditorStore((s) => s.schemaCache);
  const setSql = useSqlEditorStore((s) => s.setSql);
  const execute = useSqlEditorStore((s) => s.execute);
  const cancelWriteConfirm = useSqlEditorStore((s) => s.cancelWriteConfirm);
  const clearResults = useSqlEditorStore((s) => s.clearResults);
  const toggleStatement = useSqlEditorStore((s) => s.toggleStatement);
  const setLayout = useSqlEditorStore((s) => s.setLayout);
  const addTab = useSqlEditorStore((s) => s.addTab);
  const closeTab = useSqlEditorStore((s) => s.closeTab);
  const setActiveTab = useSqlEditorStore((s) => s.setActiveTab);
  const renameTab = useSqlEditorStore((s) => s.renameTab);
  const moveTab = useSqlEditorStore((s) => s.moveTab);
  const ensureSchema = useSqlEditorStore((s) => s.ensureSchema);
  const setMaxRows = useSqlEditorStore((s) => s.setMaxRows);
  const maxRows = useSqlEditorStore((s) => s.maxRows);
  const saveBookmark = useSqlEditorStore((s) => s.saveBookmark);
  const shareDestinations = useSqlEditorStore((s) => s.shareDestinations);
  const sharedConnectionIds = useSqlEditorStore((s) => s.sharedConnectionIds);
  const safeMode = useSqlEditorStore((s) => s.safeMode);
  const setSafeMode = useSqlEditorStore((s) => s.setSafeMode);

  const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
  // Drop connection ids that no longer exist in the saved list (persist-safe).
  const liveSelectedIds = effectiveConnectionIds(
    tab,
    shareDestinations,
    sharedConnectionIds
  ).filter((id) => connections.some((c) => c.id === id));

  const statements = useMemo(() => splitSqlStatements(tab.sql), [tab.sql]);
  const results = resultsByTab[tab.id];
  const running = runningTabId === tab.id;

  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [editorPct, setEditorPct] = useState(EDITOR_PCT_DEFAULT);
  const [hasSelection, setHasSelection] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const splitRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, toggleSidebar] = useSidebarSectionsOpen();
  const [sectionHeights, setSectionHeight] = useSidebarSectionHeights();
  const secretsPanelRef = useRef<SqlSecretsPanelHandle>(null);
  const schemaExplorerRef = useRef<SqlSchemaExplorerHandle>(null);
  const [secretsRefreshing, setSecretsRefreshing] = useState(false);

  const onSecretsRefresh = useCallback(async () => {
    setSecretsRefreshing(true);
    try {
      await secretsPanelRef.current?.refresh();
    } finally {
      setSecretsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  // Completion provider reads active SQL + checked schemas + variables via this getter.
  useEffect(() => {
    setCompletionContextGetter(() => {
      const state = useSqlEditorStore.getState();
      const active = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0]!;
      const destIds = state.activeConnectionIds();
      const schemas = destIds
        .map((id) => {
          const entry = state.schemaCache[id];
          if (entry?.status !== 'ready' || !entry.tables) return null;
          return { connectionId: id, tables: entry.tables };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      return { sql: active.sql, schemas, variables: state.variables };
    });
  }, []);

  // Warm schema cache for checked credentials (autocomplete).
  useEffect(() => {
    for (const id of liveSelectedIds) {
      if (!schemaCache[id] || schemaCache[id]?.status === 'idle') {
        void ensureSchema(id);
      }
    }
  }, [liveSelectedIds.join(','), ensureSchema]);

  const startEditorResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const root = splitRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setEditorPct(Math.min(EDITOR_PCT_MAX, Math.max(EDITOR_PCT_MIN, pct)));
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
  }, []);

  const startSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (sidebarCollapsed) return;
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(
          Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX))
        );
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
    },
    [sidebarCollapsed, sidebarWidth]
  );

  const firstSelected = connections.find((c) => liveSelectedIds.includes(c.id));
  const dialect = firstSelected?.dialect ?? 'sql';

  const selectedSqlForRun = hasSelection ? getSelectedSql() : null;
  const runStatements = useMemo(
    () => resolveRunStatements(tab.sql, tab.checkedStatements, selectedSqlForRun),
    [tab.sql, tab.checkedStatements, selectedSqlForRun]
  );
  const canRunLocal = useMemo(
    () => canExecuteWithoutDestination(runStatements),
    [runStatements]
  );
  const runCount = runStatements.length;
  const canRun = !runningTabId && (liveSelectedIds.length > 0 || canRunLocal);
  const runTitle = liveSelectedIds.length
    ? hasSelection
      ? 'Run the selected SQL  (⌘/Ctrl+Enter)'
      : !runCount
        ? `Run with empty editor against ${liveSelectedIds.length} server(s)  (⌘/Ctrl+Enter)`
        : `Run ${runCount} statement(s) against ${liveSelectedIds.length} server(s)  (⌘/Ctrl+Enter)`
    : canRunLocal
      ? `Run ${runCount} code cell(s) locally — no destination needed  (⌘/Ctrl+Enter)`
      : 'Check at least one destination server to run SQL, or use a JS/TS/Node code cell';

  const [formatNote, setFormatNote] = useState<string | null>(null);
  const formatNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onReveal = (stmt: SplitStatement) => {
    setReveal({ startLine: stmt.startLine, endLine: stmt.endLine, nonce: Date.now() });
  };

  const onFormat = () => {
    void (async () => {
      const before = tab.sql;
      const formatted = await formatEditorSql(before, dialect);
      if (formatted !== before) setSql(formatted);
      const fences = (before.match(/^\s*--\s*@(?:js|ts|node|nodets)\b/gim) ?? []).length;
      const note =
        formatted === before
          ? fences > 0
            ? 'Already formatted (SQL + Prettier JS/TS)'
            : 'Already formatted'
          : fences > 0
            ? `Formatted SQL + ${fences} JS/TS cell${fences === 1 ? '' : 's'} (Prettier)`
            : 'Formatted SQL';
      setFormatNote(note);
      if (formatNoteTimer.current) clearTimeout(formatNoteTimer.current);
      formatNoteTimer.current = setTimeout(() => setFormatNote(null), 2800);
    })();
  };

  useEffect(() => {
    return () => {
      if (formatNoteTimer.current) clearTimeout(formatNoteTimer.current);
    };
  }, []);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden" data-testid="sql-editor-view">
      {sidebarCollapsed ? (
        <aside
          className="w-10 shrink-0 border-r border-[#e2e8f0] bg-white flex flex-col items-center py-2 gap-1"
          data-testid="sql-sidebar-collapsed"
        >
          <button
            type="button"
            data-testid="sql-sidebar-expand"
            title="Show sidebar"
            aria-label="Show sidebar"
            onClick={() => setSidebarCollapsed(false)}
            className="p-1.5 rounded text-[#64748b] hover:text-[#0f172a] hover:bg-[#f1f5f9] transition"
          >
            <PanelLeftOpen className="w-4 h-4 text-[#0284c7]" strokeWidth={SQL_ICON_STROKE} />
          </button>
        </aside>
      ) : (
        <aside
          className="relative shrink-0 border-r border-[#e2e8f0] bg-white overflow-hidden flex flex-col min-h-0"
          style={{ width: sidebarWidth }}
          data-testid="sql-sidebar"
        >
          <div className="flex items-center justify-end px-2 py-1 border-b border-[#e2e8f0] shrink-0 bg-white">
            <button
              type="button"
              data-testid="sql-sidebar-collapse"
              title="Hide sidebar"
              aria-label="Hide sidebar"
              onClick={() => setSidebarCollapsed(true)}
              className="p-1 rounded text-[#64748b] hover:text-[#0f172a] hover:bg-[#f1f5f9] transition"
            >
              <PanelLeftClose className="w-3.5 h-3.5 text-[#0284c7]" strokeWidth={SQL_ICON_STROKE} />
            </button>
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden bg-white">
            <SqlSidebarSection
              id="destinations"
              title="Destination servers"
              icon={<Database className="text-[#0284c7]" strokeWidth={SQL_ICON_STROKE} />}
              open={sidebarOpen.destinations}
              onToggle={() => toggleSidebar('destinations')}
              height={sectionHeights.destinations}
              onResizeHeight={(h) => setSectionHeight('destinations', h)}
            >
              <ConnectionChecklist />
            </SqlSidebarSection>
            <SqlSidebarSection
              id="bookmarks"
              title="Bookmarks"
              icon={<Bookmark className="text-[#f59e0b]" strokeWidth={SQL_ICON_STROKE} />}
              open={sidebarOpen.bookmarks}
              onToggle={() => toggleSidebar('bookmarks')}
              height={sectionHeights.bookmarks}
              onResizeHeight={(h) => setSectionHeight('bookmarks', h)}
              actions={
                <button
                  type="button"
                  data-testid="sql-bookmark-save"
                  title="Save current query as a bookmark (uses the tab title)"
                  disabled={!tab.sql.trim()}
                  onClick={() => saveBookmark()}
                  className="flex items-center gap-0.5 text-[12px] font-bold text-[#d97706] hover:text-[#b45309] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <BookmarkPlus className="w-3.5 h-3.5 text-[#f59e0b]" strokeWidth={SQL_ICON_STROKE} /> Save
                </button>
              }
            >
              <SqlBookmarksPanel />
            </SqlSidebarSection>
            <SqlSidebarSection
              id="variables"
              title="Variables"
              icon={<Braces className="text-[#7c3aed]" strokeWidth={SQL_ICON_STROKE} />}
              open={sidebarOpen.variables}
              onToggle={() => toggleSidebar('variables')}
              height={sectionHeights.variables}
              onResizeHeight={(h) => setSectionHeight('variables', h)}
            >
              <SqlVariablesPanel />
            </SqlSidebarSection>
            <SqlSidebarSection
              id="vault"
              title="Secrets"
              icon={<KeyRound className="text-[#d97706]" strokeWidth={SQL_ICON_STROKE} />}
              open={sidebarOpen.vault}
              onToggle={() => toggleSidebar('vault')}
              height={sectionHeights.vault}
              onResizeHeight={(h) => setSectionHeight('vault', h)}
              actions={
                <button
                  type="button"
                  data-testid="sql-secrets-refresh"
                  title="Re-fetch cloud secrets into Variables"
                  disabled={secretsRefreshing}
                  onClick={() => void onSecretsRefresh()}
                  className="flex items-center gap-0.5 text-[12px] font-bold text-[#0284c7] hover:text-[#0369a1] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-[#0284c7] ${secretsRefreshing ? 'animate-spin' : ''}`}
                    strokeWidth={SQL_ICON_STROKE}
                  />
                  Refresh
                </button>
              }
            >
              <SqlSecretsPanel ref={secretsPanelRef} />
            </SqlSidebarSection>
            <SqlSidebarSection
              id="schema"
              title="Schema"
              icon={<Network className="text-[#059669]" strokeWidth={SQL_ICON_STROKE} />}
              open={sidebarOpen.schema}
              onToggle={() => toggleSidebar('schema')}
              grow
              height={sectionHeights.schema}
              onResizeHeight={(h) => setSectionHeight('schema', h)}
              actions={
                <button
                  type="button"
                  data-testid="sql-schema-new-table"
                  title="Create table — opens blueprint to add columns"
                  onClick={() => schemaExplorerRef.current?.openCreateTable()}
                  className="flex items-center gap-0.5 text-[12px] font-bold text-[#059669] hover:text-[#047857] transition"
                >
                  <Plus className="w-3.5 h-3.5 text-[#059669]" strokeWidth={SQL_ICON_STROKE} />
                  New table
                </button>
              }
            >
              <SqlSchemaExplorer ref={schemaExplorerRef} />
            </SqlSidebarSection>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            data-testid="sql-sidebar-resize"
            title="Drag to resize sidebar"
            onMouseDown={startSidebarResize}
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-cyan-500/40 active:bg-cyan-500/60 transition-colors z-10"
          />
        </aside>
      )}

      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        <EditorTabBar
          tabs={tabs}
          activeTabId={tab.id}
          onSelect={setActiveTab}
          onClose={closeTab}
          onAdd={addTab}
          onRename={renameTab}
          onMove={moveTab}
        />

        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/60 shrink-0">
          <button
            data-testid="sql-run-btn"
            onClick={() => execute()}
            disabled={!canRun}
            title={runTitle}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold transition shadow ${
              canRun
                ? 'accent-grad on-accent-fg cursor-pointer'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
            }`}
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-200" strokeWidth={SQL_ICON_STROKE} />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current text-emerald-50" strokeWidth={SQL_ICON_STROKE} />
            )}
            {hasSelection ? 'Run selection' : 'Run'}
          </button>
          <button
            type="button"
            data-testid="sql-refresh-btn"
            onClick={() => execute()}
            disabled={!canRun || !results}
            title={results ? 'Refresh results (re-run on all checked servers)' : 'Run a query first'}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-cyan-400 ${running ? 'animate-spin' : ''}`}
              strokeWidth={SQL_ICON_STROKE}
            />{' '}
            Refresh
          </button>
          <button
            type="button"
            data-testid="sql-format-btn"
            onClick={onFormat}
            disabled={!tab.sql.trim()}
            title="Pretty-print SQL (sql-formatter) and JS/TS/Node cells (Prettier)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlignLeft className="w-3.5 h-3.5 text-teal-400" strokeWidth={SQL_ICON_STROKE} /> Format
            SQL+JS
          </button>
          {formatNote && (
            <span
              data-testid="sql-format-note"
              className="text-[10px] font-semibold text-teal-300/90 animate-pulse max-w-[14rem] truncate"
              title={formatNote}
            >
              {formatNote}
            </span>
          )}
          <button
            type="button"
            data-testid="sql-bookmark-save-toolbar"
            onClick={() => saveBookmark()}
            disabled={!tab.sql.trim()}
            title="Bookmark this query (uses the tab title)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <BookmarkPlus className="w-3.5 h-3.5 text-amber-400" strokeWidth={SQL_ICON_STROKE} /> Bookmark
          </button>

          <div className="flex items-center rounded border border-slate-800 overflow-hidden ml-1">
            <button
              type="button"
              title="By credential — statements stacked vertically"
              data-testid="sql-layout-by-credential"
              onClick={() => setLayout('byCredential')}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold transition ${
                tab.layout === 'byCredential'
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Rows3 className="w-3 h-3 text-cyan-400" strokeWidth={SQL_ICON_STROKE} /> By cred
            </button>
            <button
              type="button"
              title="Side by side (per statement)"
              data-testid="sql-layout-side-by-side"
              onClick={() => setLayout('sideBySide')}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold transition border-l border-slate-800 ${
                tab.layout === 'sideBySide'
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Columns2 className="w-3 h-3 text-sky-400" strokeWidth={SQL_ICON_STROKE} /> Side-by-side
            </button>
          </div>

          <label
            className="flex items-center gap-1.5 text-[10px] font-semibold ml-1 cursor-pointer select-none"
            title="When on, UPDATE / DELETE / MERGE (and other writes) require confirmation before Run"
          >
            <input
              type="checkbox"
              data-testid="sql-safe-mode"
              checked={safeMode}
              onChange={(e) => setSafeMode(e.target.checked)}
              className="w-3.5 h-3.5 accent-rose-500 cursor-pointer"
            />
            <Shield
              className={`w-3 h-3 ${safeMode ? 'text-rose-400' : 'text-slate-500'}`}
              strokeWidth={SQL_ICON_STROKE}
            />
            <span className={safeMode ? 'text-rose-300' : 'text-slate-500'}>Safe mode</span>
          </label>

          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 ml-1" title="Rows fetched per page (Next/Prev use this size)">
            Rows/page
            <input
              data-testid="sql-max-rows"
              type="number"
              min={1}
              max={5000}
              value={maxRows}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setMaxRows(Math.min(5000, Math.max(1, Math.floor(n))));
              }}
              className="w-14 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 font-mono outline-none focus:border-cyan-600"
            />
          </label>

          <span className="text-[11px] text-slate-500 ml-1">
            {runCount} statement{runCount === 1 ? '' : 's'} · {liveSelectedIds.length} server
            {liveSelectedIds.length === 1 ? '' : 's'}
          </span>
          <div className="flex-1" />
          {results && results.runs.length > 0 && (
            <button
              onClick={clearResults}
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-300 transition"
            >
              <Eraser className="w-3 h-3 text-orange-400" strokeWidth={SQL_ICON_STROKE} /> Clear results
            </button>
          )}
        </div>

        <div ref={splitRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="min-h-[6rem] overflow-hidden border-b border-slate-800" style={{ height: `${editorPct}%` }}>
            <Suspense fallback={<EditorFallback />}>
              <SqlEditorPane
                value={tab.sql}
                statements={statements}
                dialect={dialect}
                onChange={setSql}
                onRun={() => execute()}
                onSelectionChange={setHasSelection}
                reveal={reveal}
              />
            </Suspense>
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize editor and results"
            data-testid="sql-editor-resize"
            onMouseDown={startEditorResize}
            title="Drag to resize editor / results"
            className="h-1.5 shrink-0 cursor-row-resize bg-slate-900 hover:bg-cyan-500/40 active:bg-cyan-500/60 transition-colors border-y border-slate-800/80"
          />

          <StatementStrip
            statements={statements}
            checked={tab.checkedStatements}
            running={running}
            sqlNeedsDestination={liveSelectedIds.length === 0}
            onToggle={toggleStatement}
            onReveal={onReveal}
            onRunCell={(index) => void execute({ statementIndices: [index] })}
          />

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <ResultsPanel
              runs={results?.runs ?? []}
              statements={results?.ranStatements ?? []}
              statementIndices={results?.ranStatementIndices}
              layout={tab.layout}
              refreshing={running}
              warnings={results?.warnings}
              pageState={results?.pageMeta}
              onPage={(args) => void useSqlEditorStore.getState().loadResultPage(args)}
              onRefresh={(connectionId) =>
                execute(connectionId ? { connectionIds: [connectionId] } : undefined)
              }
            />
          </div>
        </div>
      </section>

      {pendingWriteConfirm && pendingWriteConfirm.tabId === tab.id && (
        <WriteConfirmDialog
          writeStatements={pendingWriteConfirm.writeStatements}
          credentialCount={pendingWriteConfirm.credentialCount}
          readonlyTargets={pendingWriteConfirm.readonlyTargets}
          onCancel={cancelWriteConfirm}
          onConfirm={() =>
            execute({
              confirmedWrites: true,
              connectionIds: pendingWriteConfirm.connectionIds,
              statementIndices: pendingWriteConfirm.statementIndices,
            })
          }
        />
      )}
      {/* Always mounted so FK clicks from results work even when Schema is collapsed. */}
      <DataPeekPanel />
    </div>
  );
};
