import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { executeSql, type SqlStatementResult } from '../api/sqlApi';
import type { SavedConnectionSummary } from '../api/authApi';
import { resolveAppSecrets } from '../api/appSecretsApi';
import { loadSchema } from '../api/schemaApi';
import { isMutatingDmlStatement, isWriteStatement, splitSqlStatements } from '../lib/sql-splitter';
import type { CodeCellLast } from '../lib/codeCellExec';
import { detectCodeCell, runCodeCell } from '../lib/codeCellRunner';
import { buildSampleBookmarks } from '../lib/sqlEditorSamples';
import {
  buildForeignKeyDrilldown,
  buildTablePreview,
  composePeekSql,
} from '../lib/tablePreview';
import type { ForeignKeyInfo } from '../lib/types';
import { mergeVaultSecretsIntoVariables } from '../lib/mergeVaultSecrets';
import {
  applySetDirectives,
  exportVariables,
  isValidVariableName,
  normalizeVariableName,
  parseImportedVariables,
  parseSetDirectives,
  prepareStatement,
  resolveVariablesForConnection,
  stripSecretsForPersist,
  type SetDirective,
  type SqlVariable,
  type SqlVariableExport,
  type SqlVariableKind,
  type VariableOverride,
} from '../lib/sql-variables';
import { useSyncStore } from './useSyncStore';
import type { SchemaCacheEntry } from '../components/sql-editor/sqlEditorBridge';
import { getSelectedSql } from '../components/sql-editor/sqlEditorBridge';
import {
  addTab as addTabLogic,
  checkedAfterSqlChange,
  closeTab as closeTabLogic,
  createTab,
  destinationIdsPatch,
  effectiveConnectionIds,
  hydrateTabs,
  moveTab as moveTabLogic,
  newTabId,
  persistableTabs,
  canExecuteWithoutDestination,
  indicesToRun,
  resolveRunStatements,
  statementsToRun,
  toggleStatementCheck,
  type ResultsLayout,
  type SqlTab,
} from './sqlEditorTabLogic';

export type { SqlVariable, SqlVariableKind, SqlVariableExport, VariableOverride };

/** Dialects whose adapters are SELECT-only — writes fail with a friendly error. */
const READONLY_DIALECTS = new Set(['sqlite', 'clickhouse']);

type ExecutionTarget = Pick<SavedConnectionSummary, 'id' | 'name' | 'dialect' | 'hasPassword'>;

/** Synthetic run target when executing code cells with no Destination checked. */
const LOCAL_CODE_RUN_TARGET: ExecutionTarget = {
  id: '__local__',
  name: 'Local',
  dialect: 'editor',
  hasPassword: true,
};

/** Saved SQL script bookmark (persisted). */
export interface SqlBookmark {
  id: string;
  title: string;
  sql: string;
  selectedConnectionIds: string[];
  updatedAt: number;
}

/** One checked credential's execution state for a tab's last run. */
export interface CredentialRun {
  connectionId: string;
  name: string;
  dialect: string;
  status: 'running' | 'done' | 'error';
  /** Connection-level failure (unreachable, bad password) — statement results absent. */
  error?: string;
  /** Per-statement outcomes, in statement order. */
  results?: SqlStatementResult[];
}

export interface TabResults {
  ranStatements: string[];
  /**
   * 0-based source cell indices aligned with `ranStatements` (for `Out [n]`).
   * Omitted for selection runs where indices are local to the selection.
   */
  ranStatementIndices?: number[];
  runs: CredentialRun[];
  /** Non-fatal messages (e.g. `@set` failures) for this run. */
  warnings?: string[];
  /**
   * Bumped on each execute start. Stale `loadResultPage` responses must not
   * apply when this no longer matches the epoch captured at fetch start.
   */
  pageEpoch?: number;
  /**
   * Per-connection prepared SQL for each statement index — used for Next/Prev page
   * without re-substituting variables.
   */
  pageSqlByConnection?: Record<string, string[]>;
  /** Cache of result pages: `${connectionId}:${statementIndex}:${pageIndex}` → result. */
  pageCache?: Record<string, SqlStatementResult>;
  /** UI page cursor + hasNext: `${connectionId}:${statementIndex}`. */
  pageMeta?: Record<string, ResultPageMeta>;
}

/** True when a page fetch may still write into this tab's results. */
export function isCurrentPageEpoch(
  expectedEpoch: number,
  currentEpoch: number | undefined
): boolean {
  return currentEpoch === expectedEpoch;
}

/** Per-statement result page cursor (server OFFSET paging). */
export interface ResultPageMeta {
  pageIndex: number;
  hasNext: boolean;
  loading?: boolean;
  pageSize: number;
}

function pageMetaKey(connectionId: string, statementIndex: number): string {
  return `${connectionId}:${statementIndex}`;
}

function pageCacheKey(connectionId: string, statementIndex: number, pageIndex: number): string {
  return `${pageMetaKey(connectionId, statementIndex)}:${pageIndex}`;
}

/** Max cached pages per statement (current page + a few neighbors). */
const MAX_PAGES_PER_STATEMENT = 5;
/** Soft TTL for loaded schema explorer entries. */
const SCHEMA_CACHE_TTL_MS = 15 * 60 * 1000;
/** Max connections kept in schemaCache (LRU by loadedAt). */
const SCHEMA_CACHE_MAX = 8;
/** Cap persisted tab/bookmark SQL to avoid QuotaExceededError. */
export const MAX_PERSISTED_SQL_CHARS = 256 * 1024;
/** Cap persisted bookmark count. */
export const MAX_PERSISTED_BOOKMARKS = 100;

/** Keep at most `maxPages` pages for one statement, preferring those near `keepAroundPage`. */
export function boundPageCache(
  cache: Record<string, SqlStatementResult>,
  connectionId: string,
  statementIndex: number,
  keepAroundPage: number,
  maxPages = MAX_PAGES_PER_STATEMENT
): Record<string, SqlStatementResult> {
  const prefix = `${pageMetaKey(connectionId, statementIndex)}:`;
  const keys = Object.keys(cache).filter((k) => k.startsWith(prefix));
  if (keys.length <= maxPages) return cache;
  const ranked = keys
    .map((k) => {
      const page = Number(k.slice(prefix.length));
      return { k, page, dist: Math.abs(page - keepAroundPage) };
    })
    .sort((a, b) => b.dist - a.dist || b.page - a.page);
  const next = { ...cache };
  while (ranked.length > maxPages) {
    const drop = ranked.shift();
    if (!drop) break;
    delete next[drop.k];
  }
  return next;
}

export function truncatePersistedSql(sql: string, max = MAX_PERSISTED_SQL_CHARS): string {
  if (sql.length <= max) return sql;
  return sql.slice(0, max);
}

/** Drop expired schema entries and enforce max connection count (LRU by loadedAt). */
export function pruneSchemaCache(
  cache: Record<string, SchemaCacheEntry>,
  now = Date.now()
): Record<string, SchemaCacheEntry> {
  const next: Record<string, SchemaCacheEntry> = {};
  for (const [id, entry] of Object.entries(cache)) {
    if (
      entry.status === 'ready' &&
      typeof entry.loadedAt === 'number' &&
      now - entry.loadedAt >= SCHEMA_CACHE_TTL_MS
    ) {
      continue;
    }
    next[id] = entry;
  }
  const ready = Object.entries(next)
    .filter(([, e]) => e.status === 'ready')
    .sort((a, b) => (a[1].loadedAt ?? 0) - (b[1].loadedAt ?? 0));
  while (ready.length > SCHEMA_CACHE_MAX) {
    const drop = ready.shift();
    if (!drop) break;
    delete next[drop[0]];
  }
  return next;
}

/** Password prompt for a connection saved without one (session-only). */
export interface PendingPasswordPrompt {
  id: string;
  name: string;
  /** When true, resume execute() after the password is submitted. */
  resumeExecute: boolean;
  /** When set, resume only refreshes these credentials. */
  connectionIds?: string[];
  /** When set, resume runs only these statement indices (per-cell Play). */
  statementIndices?: number[];
}

export interface ReadonlyWriteTarget {
  name: string;
  dialect: string;
}

export interface DataPeekEntry {
  id: string;
  /** Heading, e.g. `public.users` or `customers · id = 7`. */
  title: string;
  /** Table the rows came from — drives the FK links on this grid. */
  tableName: string;
  /** Bound base query before user WHERE / ORDER BY filters. */
  baseSql: string;
  baseParams: unknown[];
  /** User filter text (no leading WHERE). */
  whereClause: string;
  /** User sort text (no leading ORDER BY). */
  orderByClause: string;
  /** Rows/page for this peek panel (sent as execute page size). */
  limit: number;
  /** 0-based page for server OFFSET paging. */
  pageIndex: number;
  /** Composed SQL actually executed. */
  sql: string;
  params: unknown[];
  status: 'loading' | 'ready' | 'error';
  result?: SqlStatementResult;
  error?: string;
  /** Parent peek this drill opened from (root has no parent). */
  parentId?: string;
  /**
   * Stable slot for sibling drills from the same parent + FK column.
   * Re-clicking the same FK replaces this panel; other FK columns stack.
   */
  drillKey?: string;
  /** Optional manual panel height (px); drag handle updates this. */
  panelHeightPx?: number;
}

export interface DataPeekFilterPatch {
  whereClause?: string;
  orderByClause?: string;
  limit?: number;
}

export interface DataPeekState {
  connectionId: string;
  dialect: string;
  entries: DataPeekEntry[];
}

/** Rows fetched per peek grid — a peek is a glance, not a report. */
const DATA_PEEK_ROWS = 50;

/** Drop an entry and any drills that descend from it. */
export function removeDataPeekSubtree(
  entries: DataPeekEntry[],
  rootId: string
): DataPeekEntry[] {
  const drop = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of entries) {
      if (e.parentId && drop.has(e.parentId) && !drop.has(e.id)) {
        drop.add(e.id);
        grew = true;
      }
    }
  }
  return entries.filter((e) => !drop.has(e.id));
}

/** Move one peek panel in the stacked list (visual arrange). */
export function moveDataPeekEntry(
  entries: DataPeekEntry[],
  fromIndex: number,
  toIndex: number
): DataPeekEntry[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= entries.length ||
    toIndex >= entries.length
  ) {
    return entries;
  }
  const next = [...entries];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}

function dataPeekDrillKey(
  fromEntryId: string,
  fk: { referencedTable: string; columns?: string[] }
): string {
  return `${fromEntryId}|${fk.referencedTable}|${(fk.columns ?? []).join(',')}`;
}

interface SqlEditorState {
  tabs: SqlTab[];
  activeTabId: string;
  /** Results keyed by tab id — never persisted. */
  resultsByTab: Record<string, TabResults>;
  /** Session-only passwords. NEVER persisted. */
  sessionPasswords: Record<string, string>;
  /** Loaded schemas by connection id — never persisted. */
  schemaCache: Record<string, SchemaCacheEntry>;
  /** Tab currently executing (null when idle). */
  runningTabId: string | null;
  pendingWriteConfirm: {
    tabId: string;
    writeStatements: string[];
    credentialCount: number;
    /** Checked credentials whose dialect cannot execute writes. */
    readonlyTargets: ReadonlyWriteTarget[];
    /** When set, confirm resumes execute for only these credentials. */
    connectionIds?: string[];
    /** When set, confirm resumes execute for only these statement indices. */
    statementIndices?: number[];
  } | null;
  pendingPassword: PendingPasswordPrompt | null;
  maxRows: number;
  /**
   * When true, confirm before UPDATE / DELETE / MERGE (and other writes).
   * Default on — turn off only when you intentionally want unguarded runs.
   */
  safeMode: boolean;
  /**
   * When true, every query tab shares `sharedConnectionIds`.
   * When false, each tab keeps its own `selectedConnectionIds`.
   */
  shareDestinations: boolean;
  sharedConnectionIds: string[];
  /** Named saved scripts — persisted. */
  bookmarks: SqlBookmark[];
  /** Global SQL Editor variables (`${{name}}`) — persisted. */
  variables: SqlVariable[];

  activeTab: () => SqlTab;
  /** Destination server ids for the active tab (respects shareDestinations). */
  activeConnectionIds: () => string[];
  setSql: (sql: string) => void;
  toggleConnection: (id: string) => void;
  /**
   * Ensure a destination credential is checked for the active tab (add-only).
   * Used to keep the Schema explorer selection aligned with Destination servers.
   * May open the session-password prompt when the credential has no stored password.
   */
  ensureConnectionSelected: (id: string) => void;
  setShareDestinations: (share: boolean) => void;
  setSafeMode: (on: boolean) => void;
  toggleStatement: (index: number) => void;
  setLayout: (layout: ResultsLayout) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  /** Drag-reorder query tabs. No-op when indices are equal/out of range. */
  moveTab: (fromIndex: number, toIndex: number) => void;
  submitSessionPassword: (password: string) => void;
  cancelPasswordPrompt: () => void;
  setMaxRows: (n: number) => void;
  ensureSchema: (connectionId: string, opts?: { force?: boolean }) => Promise<void>;
  /**
   * Re-run SQL.
   * - `connectionIds` — refresh only those credentials (keeps other panes).
   * - `statementIndices` — run only these split indices (per-cell Play; ignores
   *   strip checks and editor selection).
   */
  execute: (opts?: {
    confirmedWrites?: boolean;
    connectionIds?: string[];
    statementIndices?: number[];
  }) => Promise<void>;
  /** Load a cached or server page for one statement result grid. */
  loadResultPage: (args: {
    connectionId: string;
    statementIndex: number;
    pageIndex: number;
  }) => Promise<void>;
  cancelWriteConfirm: () => void;
  clearResults: () => void;
  saveBookmark: (opts?: { title?: string }) => void;
  openBookmark: (id: string) => void;
  renameBookmark: (id: string, title: string) => void;
  deleteBookmark: (id: string) => void;
  /** Merge built-in JS/TS/Node sample bookmarks (by stable id). Returns how many were added/updated. */
  installSampleBookmarks: () => number;

  /**
   * Cmd/Ctrl-click data peek: a stack of grids, each drilled from the one above
   * via a foreign key. Never persisted — it is a look, not a document.
   */
  dataPeek: DataPeekState | null;
  openDataPeek: (connectionId: string, tableName: string) => Promise<void>;
  drillDataPeek: (
    fromEntryId: string,
    fk: ForeignKeyInfo,
    values: unknown[]
  ) => Promise<void>;
  closeDataPeek: () => void;
  /** Drop `entryId` and every grid below it (click a breadcrumb to go back). */
  closeDataPeekFrom: (entryId: string) => void;
  /** Apply WHERE / ORDER BY / LIMIT on one peek panel and re-run. */
  updateDataPeekFilters: (entryId: string, patch: DataPeekFilterPatch) => Promise<void>;
  /** Persist a dragged panel height. */
  setDataPeekPanelHeight: (entryId: string, heightPx: number) => void;
  /** Drag panels to rearrange the vertical stack. */
  reorderDataPeekEntries: (fromIndex: number, toIndex: number) => void;
  /** Load another OFFSET page for one peek panel. */
  pageDataPeekEntry: (entryId: string, pageIndex: number) => Promise<void>;
  /** Internal: (re)run one peek entry's query. */
  runDataPeekEntry: (entryId: string) => Promise<void>;
  /** Create or overwrite a variable by name. Returns error string or null. */
  upsertVariable: (input: {
    name: string;
    kind: SqlVariableKind;
    value?: unknown;
    values?: unknown[];
    columns?: string[];
    rows?: unknown[][];
    secret?: boolean;
    overrides?: Record<string, VariableOverride>;
    /** When set, rename/update that id instead of matching by name. */
    id?: string;
  }) => string | null;
  deleteVariable: (id: string) => void;
  setVariableSecret: (id: string, secret: boolean) => void;
  setVariableOverride: (
    id: string,
    connectionId: string,
    override: VariableOverride | null
  ) => void;
  /** Merge imported variables by name. Returns error or null. */
  importVariables: (raw: unknown, opts?: { overwrite?: boolean }) => string | null;
  exportVariablesJson: () => string;
}

const firstTab = createTab({ title: 'Query 1' });

export type { ResultsLayout, SqlTab };

export const useSqlEditorStore = create<SqlEditorState>()(
  persist(
    (set, get) => ({
      tabs: [firstTab],
      activeTabId: firstTab.id,
      resultsByTab: {},
      sessionPasswords: {},
      schemaCache: {},
      runningTabId: null,
      pendingWriteConfirm: null,
      pendingPassword: null,
      maxRows: 200,
      safeMode: true,
      shareDestinations: true,
      sharedConnectionIds: [],
      bookmarks: [],
      variables: [],

      activeTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
      },

      activeConnectionIds: () => {
        const { tabs, activeTabId, shareDestinations, sharedConnectionIds } = get();
        const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
        return effectiveConnectionIds(tab, shareDestinations, sharedConnectionIds);
      },

      setSql: (sql) => {
        const { tabs, activeTabId } = get();
        set({
          tabs: tabs.map((t) => {
            if (t.id !== activeTabId) return t;
            // One split of the new buffer; previous count is cached on the tab.
            const statementCount = splitSqlStatements(sql).length;
            return {
              ...t,
              sql,
              statementCount,
              checkedStatements: checkedAfterSqlChange(
                t.statementCount,
                statementCount,
                t.checkedStatements
              ),
            };
          }),
        });
      },

      setShareDestinations: (share) => {
        const { tabs, activeTabId, sharedConnectionIds } = get();
        const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
        if (share) {
          // Adopt the active tab's destinations as the shared set.
          set({
            shareDestinations: true,
            sharedConnectionIds: [...active.selectedConnectionIds],
          });
          return;
        }
        // Push shared destinations onto every tab so nothing is lost.
        set({
          shareDestinations: false,
          tabs: tabs.map((t) => ({
            ...t,
            selectedConnectionIds: [...sharedConnectionIds],
          })),
        });
      },

      toggleConnection: (id) => {
        const { tabs, activeTabId, shareDestinations, sharedConnectionIds } = get();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (!tab) return;

        const current = shareDestinations ? sharedConnectionIds : tab.selectedConnectionIds;
        if (current.includes(id)) {
          set(
            destinationIdsPatch(
              shareDestinations,
              tabs,
              activeTabId,
              current.filter((x) => x !== id)
            )
          );
          return;
        }

        get().ensureConnectionSelected(id);
      },

      ensureConnectionSelected: (id) => {
        const { tabs, activeTabId, sessionPasswords, shareDestinations, sharedConnectionIds } =
          get();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (!tab || !id) return;

        const current = shareDestinations ? sharedConnectionIds : tab.selectedConnectionIds;
        if (current.includes(id)) return;

        const conn = useSyncStore.getState().connections.find((c) => c.id === id);
        if (conn && !conn.hasPassword && !sessionPasswords[id]) {
          set({
            pendingPassword: {
              id,
              name: conn.name || conn.dialect,
              resumeExecute: false,
            },
          });
          return;
        }

        set(destinationIdsPatch(shareDestinations, tabs, activeTabId, [...current, id]));
        void get().ensureSchema(id);
      },

      toggleStatement: (index) => {
        const { tabs, activeTabId } = get();
        set({
          tabs: tabs.map((t) =>
            t.id === activeTabId
              ? { ...t, checkedStatements: toggleStatementCheck(t.checkedStatements, index) }
              : t
          ),
        });
      },

      setLayout: (layout) => {
        const { tabs, activeTabId } = get();
        set({
          tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, layout } : t)),
        });
      },

      addTab: () => {
        const next = addTabLogic(get().tabs);
        set(next);
      },

      closeTab: (id) => {
        const { tabs, activeTabId, resultsByTab } = get();
        const next = closeTabLogic(tabs, activeTabId, id);
        const { [id]: _removed, ...restResults } = resultsByTab;
        set({ ...next, resultsByTab: restResults });
      },

      setActiveTab: (id) => {
        if (get().tabs.some((t) => t.id === id)) set({ activeTabId: id });
      },

      moveTab: (fromIndex, toIndex) => {
        const next = moveTabLogic(get().tabs, fromIndex, toIndex);
        if (next !== get().tabs) set({ tabs: next });
      },

      renameTab: (id, title) => {
        const trimmed = title.trim() || 'Query';
        const { tabs, bookmarks } = get();
        const tab = tabs.find((t) => t.id === id);
        if (!tab) return;

        // Prefer an explicit link; otherwise match the bookmark we saved from this SQL.
        let linkId = tab.bookmarkId;
        if (!linkId) {
          const byTitleAndSql = bookmarks.find(
            (b) => b.title === tab.title && b.sql === tab.sql
          );
          const bySqlAlone = bookmarks.filter((b) => b.sql === tab.sql);
          linkId =
            byTitleAndSql?.id ??
            (bySqlAlone.length === 1 ? bySqlAlone[0]!.id : undefined);
        }

        set({
          tabs: tabs.map((t) =>
            t.id === id
              ? { ...t, title: trimmed, ...(linkId ? { bookmarkId: linkId } : {}) }
              : t
          ),
          bookmarks: linkId
            ? bookmarks.map((b) =>
                b.id === linkId ? { ...b, title: trimmed, updatedAt: Date.now() } : b
              )
            : bookmarks,
        });
      },

      submitSessionPassword: (password) => {
        const { pendingPassword, tabs, activeTabId, shareDestinations, sharedConnectionIds } =
          get();
        if (!pendingPassword) return;
        const { id, resumeExecute, connectionIds, statementIndices } = pendingPassword;

        const current = shareDestinations
          ? sharedConnectionIds
          : (tabs.find((t) => t.id === activeTabId)?.selectedConnectionIds ?? []);
        const destPatch = current.includes(id)
          ? {}
          : destinationIdsPatch(shareDestinations, tabs, activeTabId, [...current, id]);

        set({
          sessionPasswords: { ...get().sessionPasswords, [id]: password },
          pendingPassword: null,
          ...destPatch,
        });
        if (resumeExecute) {
          void get().execute({
            ...(connectionIds?.length ? { connectionIds } : {}),
            ...(statementIndices?.length ? { statementIndices } : {}),
          });
        } else {
          void get().ensureSchema(id, { force: true });
        }
      },

      cancelPasswordPrompt: () => set({ pendingPassword: null }),

      setMaxRows: (n) => set({ maxRows: Math.min(5000, Math.max(1, Math.floor(n) || 200)) }),

      setSafeMode: (on) => set({ safeMode: on }),

      ensureSchema: async (connectionId, { force = false } = {}) => {
        const SQL_EDITOR_SCOPE = ['TABLE', 'VIEW', 'MQT', 'PROCEDURE', 'FUNCTION'] as const;
        const prunedStart = pruneSchemaCache(get().schemaCache);
        if (Object.keys(prunedStart).length !== Object.keys(get().schemaCache).length) {
          set({ schemaCache: prunedStart });
        }
        const existing = get().schemaCache[connectionId];
        const scopeKey = SQL_EDITOR_SCOPE.join(',');
        const scopeOk = existing?.scope?.join(',') === scopeKey;
        const fresh =
          existing?.status === 'ready' &&
          typeof existing.loadedAt === 'number' &&
          Date.now() - existing.loadedAt < SCHEMA_CACHE_TTL_MS;
        if (
          !force &&
          scopeOk &&
          (existing?.status === 'loading' || (existing?.status === 'ready' && fresh))
        ) {
          return;
        }

        const conn = useSyncStore.getState().connections.find((c) => c.id === connectionId);
        if (!conn) {
          set({
            schemaCache: pruneSchemaCache({
              ...get().schemaCache,
              [connectionId]: { status: 'error', error: 'Connection not found' },
            }),
          });
          return;
        }

        const { sessionPasswords } = get();
        if (!conn.hasPassword && !sessionPasswords[connectionId]) {
          set({
            pendingPassword: {
              id: connectionId,
              name: conn.name || conn.dialect,
              resumeExecute: false,
            },
            schemaCache: pruneSchemaCache({
              ...get().schemaCache,
              [connectionId]: {
                status: 'error',
                error: 'Password required — enter it when prompted, then reload schema.',
              },
            }),
          });
          return;
        }

        set({
          schemaCache: pruneSchemaCache({
            ...get().schemaCache,
            [connectionId]: {
              status: 'loading',
              tables: existing?.tables,
              scope: [...SQL_EDITOR_SCOPE],
            },
          }),
        });

        try {
          const { tables } = await loadSchema(
            { connectionId, password: sessionPasswords[connectionId] || undefined },
            [...SQL_EDITOR_SCOPE]
          );
          set({
            schemaCache: pruneSchemaCache({
              ...get().schemaCache,
              [connectionId]: {
                status: 'ready',
                tables,
                scope: [...SQL_EDITOR_SCOPE],
                loadedAt: Date.now(),
              },
            }),
          });
        } catch (error: unknown) {
          set({
            schemaCache: pruneSchemaCache({
              ...get().schemaCache,
              [connectionId]: {
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
                scope: [...SQL_EDITOR_SCOPE],
              },
            }),
          });
        }
      },

      cancelWriteConfirm: () => set({ pendingWriteConfirm: null }),

      clearResults: () => {
        const { activeTabId, resultsByTab } = get();
        const { [activeTabId]: _cleared, ...rest } = resultsByTab;
        set({ resultsByTab: rest });
      },

      execute: async ({ confirmedWrites = false, connectionIds, statementIndices } = {}) => {
        const {
          tabs,
          activeTabId,
          sessionPasswords,
          maxRows,
          runningTabId,
          shareDestinations,
          sharedConnectionIds,
          safeMode,
        } = get();
        if (runningTabId) return;

        const tab = tabs.find((t) => t.id === activeTabId);
        if (!tab) return;

        const destIds = effectiveConnectionIds(tab, shareDestinations, sharedConnectionIds);
        const selected = useSyncStore
          .getState()
          .connections.filter((c) => destIds.includes(c.id));
        const selectedConnections =
          connectionIds && connectionIds.length > 0
            ? selected.filter((c) => connectionIds.includes(c.id))
            : selected;

        // Per-cell Play: run exactly those indices (ignore strip checks + selection).
        const selectedSql = getSelectedSql();
        const fromSelection =
          !(statementIndices && statementIndices.length > 0) && Boolean(selectedSql?.trim());
        const rawStatements =
          statementIndices && statementIndices.length > 0
            ? statementsToRun(tab.sql, statementIndices)
            : resolveRunStatements(tab.sql, tab.checkedStatements, selectedSql);
        // Align Out [n] with In [n] when running from strip / Play (not selection).
        const sourceIndices = fromSelection
          ? null
          : indicesToRun(
              tab.sql,
              statementIndices && statementIndices.length > 0
                ? statementIndices
                : tab.checkedStatements
            );

        // Code cells (JS/TS/Node) can run with no Destination; SQL still needs one.
        let connections: ExecutionTarget[] = selectedConnections;
        if (connections.length === 0) {
          if (!canExecuteWithoutDestination(rawStatements)) {
            const prev = get().resultsByTab[tab.id];
            set({
              resultsByTab: {
                ...get().resultsByTab,
                [tab.id]: {
                  ranStatements: prev?.ranStatements ?? [],
                  ranStatementIndices: prev?.ranStatementIndices,
                  runs: prev?.runs ?? [],
                  warnings: ['Check a Destination server to run SQL cells.'],
                  pageEpoch: prev?.pageEpoch,
                  pageCache: prev?.pageCache,
                  pageMeta: prev?.pageMeta,
                  pageSqlByConnection: prev?.pageSqlByConnection,
                },
              },
            });
            return;
          }
          connections = [LOCAL_CODE_RUN_TARGET];
        }

        const needingPassword = connections.find(
          (c) => !c.hasPassword && !sessionPasswords[c.id]
        );
        if (needingPassword) {
          set({
            pendingPassword: {
              id: needingPassword.id,
              name: needingPassword.name || needingPassword.dialect,
              resumeExecute: true,
              connectionIds: connectionIds?.length ? connectionIds : undefined,
              statementIndices: statementIndices?.length ? statementIndices : undefined,
            },
          });
          return;
        }

        // Safe mode: confirm on stripped SQL (ignore @set lines; vars may resolve mid-run).
        const strippedForConfirm = rawStatements.map((s) => parseSetDirectives(s).sql);
        const writeStatements = strippedForConfirm.filter((s) => isWriteStatement(s));
        const mutatingDml = writeStatements.filter((s) => isMutatingDmlStatement(s));
        const needsConfirm =
          safeMode &&
          !confirmedWrites &&
          (mutatingDml.length > 0 || writeStatements.length > 0);
        if (needsConfirm) {
          const readonlyTargets = connections
            .filter((c) => READONLY_DIALECTS.has(c.dialect.toLowerCase()))
            .map((c) => ({ name: c.name || c.dialect, dialect: c.dialect }));
          set({
            pendingWriteConfirm: {
              tabId: tab.id,
              writeStatements,
              credentialCount: connections.length,
              readonlyTargets,
              connectionIds: connectionIds?.length ? connectionIds : undefined,
              statementIndices: statementIndices?.length ? statementIndices : undefined,
            },
          });
          return;
        }

        const tabId = tab.id;
        const targetIds = new Set(connections.map((c) => c.id));
        const existing = get().resultsByTab[tabId];
        const partial = Boolean(connectionIds?.length && existing);

        const runningStub = (c: (typeof connections)[number]): CredentialRun => ({
          connectionId: c.id,
          name: c.name || c.dialect,
          dialect: c.dialect,
          status: 'running',
        });

        let nextRuns: CredentialRun[];
        if (partial && existing) {
          nextRuns = existing.runs.map((r) =>
            targetIds.has(r.connectionId)
              ? {
                  connectionId: r.connectionId,
                  name: r.name,
                  dialect: r.dialect,
                  status: 'running' as const,
                }
              : r
          );
          for (const c of connections) {
            if (!nextRuns.some((r) => r.connectionId === c.id)) {
              nextRuns.push(runningStub(c));
            }
          }
        } else {
          nextRuns = connections.map(runningStub);
        }

        // Accumulate per-connection results as we run statements sequentially.
        const resultsByConn = new Map<string, SqlStatementResult[]>();
        const pageSqlByConn = new Map<string, string[]>();
        for (const c of connections) {
          resultsByConn.set(c.id, []);
          pageSqlByConn.set(c.id, []);
        }

        const pageEpoch = (get().resultsByTab[tabId]?.pageEpoch ?? 0) + 1;
        set({
          pendingWriteConfirm: null,
          runningTabId: tabId,
          resultsByTab: {
            ...get().resultsByTab,
            [tabId]: {
              ranStatements: [],
              ranStatementIndices: [],
              runs: nextRuns,
              warnings: [],
              pageEpoch,
              pageCache: {},
              pageMeta: {},
              pageSqlByConnection: {},
            },
          },
        });

        const patchRun = (id: string, patch: Partial<CredentialRun>) =>
          set((state) => {
            const current = state.resultsByTab[tabId];
            if (!current) return state;
            return {
              resultsByTab: {
                ...state.resultsByTab,
                [tabId]: {
                  ...current,
                  runs: current.runs.map((r) => (r.connectionId === id ? { ...r, ...patch } : r)),
                },
              },
            };
          });

        const setRanStatements = (stmts: string[], indices: number[]) =>
          set((state) => {
            const current = state.resultsByTab[tabId];
            if (!current) return state;
            return {
              resultsByTab: {
                ...state.resultsByTab,
                [tabId]: {
                  ...current,
                  ranStatements: stmts,
                  ranStatementIndices: indices,
                },
              },
            };
          });

        const appendWarning = (msg: string) =>
          set((state) => {
            const current = state.resultsByTab[tabId];
            if (!current) return state;
            return {
              resultsByTab: {
                ...state.resultsByTab,
                [tabId]: {
                  ...current,
                  warnings: [...(current.warnings ?? []), msg],
                },
              },
            };
          });

        // Vault secrets (local + cloud) merge into vars for this Run; session Variables win on name clash.
        let runVariables = get().variables;
        try {
          const vault = await resolveAppSecrets();
          for (const [name, msg] of Object.entries(vault.errors)) {
            appendWarning(`Secret "${name}": ${msg}`);
          }
          runVariables = mergeVaultSecretsIntoVariables(get().variables, vault.secrets);
        } catch (err: unknown) {
          appendWarning(
            `App Secrets unavailable: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        const ranDisplay: string[] = [];
        const ranIndexDisplay: number[] = [];
        let aborted: string | null = null;

        const lastGridFrom = (prev: SqlStatementResult[]): CodeCellLast => {
          const prior = prev[prev.length - 1];
          return prior?.ok
            ? { columns: prior.columns, rows: prior.rows, rowCount: prior.rowCount }
            : null;
        };

        const setPageSql = (connectionId: string, index: number, sql: string) => {
          const sqlList = pageSqlByConn.get(connectionId) ?? [];
          while (sqlList.length < index) sqlList.push('');
          sqlList[index] = sql;
          pageSqlByConn.set(connectionId, sqlList);
        };

        const applySetsFromFirstOk = (directives: SetDirective[], index: number) => {
          if (directives.length === 0) return;
          for (const c of connections) {
            const res = resultsByConn.get(c.id)?.[index];
            if (!res?.ok) continue;
            const sets = applySetDirectives(directives, res);
            if (sets.ok) {
              for (const u of sets.updates) get().upsertVariable(u);
            } else {
              appendWarning(sets.error);
            }
            break;
          }
        };

        for (let si = 0; si < rawStatements.length; si++) {
          const raw = rawStatements[si]!;

          if (detectCodeCell(raw)) {
            ranDisplay.push(raw);
            ranIndexDisplay.push(sourceIndices?.[si] ?? si);
            setRanStatements([...ranDisplay], [...ranIndexDisplay]);

            let codeDirectives: SetDirective[] = [];
            const isLastStmt = si === rawStatements.length - 1;

            await Promise.allSettled(
              connections.map(async (c) => {
                const prev = resultsByConn.get(c.id) ?? [];
                try {
                  const { result, directives } = await runCodeCell({
                    statement: raw,
                    last: lastGridFrom(prev),
                    variables: resolveVariablesForConnection(runVariables, c.id),
                    maxRows,
                    // A `-- @node` cell's `sql` runs on the same credential the
                    // rest of the run uses, under the same Safe-mode policy.
                    ref: { connectionId: c.id, password: sessionPasswords[c.id] || undefined },
                    allowWrites: !safeMode,
                  });
                  codeDirectives = directives;
                  prev.push(result);
                  resultsByConn.set(c.id, prev);
                  setPageSql(c.id, si, ''); // code cells are not re-pageable
                  patchRun(c.id, {
                    status: isLastStmt ? 'done' : 'running',
                    results: [...prev],
                    error: result.ok ? undefined : result.error,
                  });
                } catch (error: unknown) {
                  const msg = error instanceof Error ? error.message : String(error);
                  prev.push({ ok: false, error: msg, durationMs: 0 });
                  resultsByConn.set(c.id, prev);
                  patchRun(c.id, {
                    status: 'error',
                    error: msg,
                    results: [...prev],
                  });
                }
              })
            );

            applySetsFromFirstOk(codeDirectives, si);
            continue;
          }

          const { directives } = parseSetDirectives(raw);

          type Prep =
            | { ok: true; sql: string }
            | { ok: false; error: string };
          const preparedByConn = new Map<string, Prep>();
          for (const c of connections) {
            const vars = resolveVariablesForConnection(runVariables, c.id);
            const prepared = prepareStatement(raw, vars);
            preparedByConn.set(
              c.id,
              prepared.ok
                ? { ok: true, sql: prepared.sql }
                : { ok: false, error: prepared.error }
            );
          }

          const firstOk = [...preparedByConn.values()].find((p) => p.ok);
          const firstErr = [...preparedByConn.values()].find((p) => !p.ok);
          if (!firstOk) {
            aborted = firstErr && !firstErr.ok ? firstErr.error : 'Variable substitution failed';
            for (const c of connections) {
              const prep = preparedByConn.get(c.id)!;
              const prev = resultsByConn.get(c.id) ?? [];
              const filler: SqlStatementResult = {
                ok: false,
                error: prep.ok ? aborted : prep.error,
                durationMs: 0,
              };
              while (prev.length < si) {
                prev.push({ ok: false, error: 'Skipped', durationMs: 0 });
              }
              prev.push(filler);
              resultsByConn.set(c.id, prev);
              patchRun(c.id, {
                status: 'error',
                error: prep.ok ? aborted : prep.error,
                results: [...prev],
              });
            }
            break;
          }

          ranDisplay.push(firstOk.sql);
          ranIndexDisplay.push(sourceIndices?.[si] ?? si);
          setRanStatements([...ranDisplay], [...ranIndexDisplay]);

          await Promise.allSettled(
            connections.map(async (c) => {
              const prev = resultsByConn.get(c.id) ?? [];
              const prep = preparedByConn.get(c.id)!;
              if (!prep.ok) {
                prev.push({ ok: false, error: prep.error, durationMs: 0 });
                resultsByConn.set(c.id, prev);
                patchRun(c.id, {
                  status: 'error',
                  error: prep.error,
                  results: [...prev],
                });
                return;
              }
              try {
                const { results } = await executeSql(
                  { connectionId: c.id, password: sessionPasswords[c.id] || undefined },
                  [prep.sql],
                  maxRows,
                  0
                );
                const one = results[0] ?? {
                  ok: false as const,
                  error: 'No result returned',
                  durationMs: 0,
                };
                prev.push(one);
                resultsByConn.set(c.id, prev);
                setPageSql(c.id, si, prep.sql);
                const last = si === rawStatements.length - 1;
                patchRun(c.id, {
                  status: last ? 'done' : 'running',
                  results: [...prev],
                  error: undefined,
                });
              } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                prev.push({ ok: false, error: msg, durationMs: 0 });
                resultsByConn.set(c.id, prev);
                patchRun(c.id, {
                  status: 'error',
                  error: msg,
                  results: [...prev],
                });
              }
            })
          );

          // @set from the first successful credential result (connection list order).
          // Writes the global base value (not a per-connection override).
          applySetsFromFirstOk(directives, si);
        }

        // Mark any still-running connections as done.
        for (const c of connections) {
          const run = get().resultsByTab[tabId]?.runs.find((r) => r.connectionId === c.id);
          if (run?.status === 'running') {
            patchRun(c.id, {
              status: aborted ? 'error' : 'done',
              error: aborted ?? run.error,
              results: resultsByConn.get(c.id),
            });
          }
        }

        // Seed page 0 cache from this run (avoids re-fetch on Prev after Next).
        // Pin pageSize to this run so Next/Prev stay aligned if Max rows changes later.
        let pageCache: Record<string, SqlStatementResult> = {};
        const pageMeta: Record<string, ResultPageMeta> = {};
        const pageSqlByConnection: Record<string, string[]> = {};
        for (const c of connections) {
          pageSqlByConnection[c.id] = pageSqlByConn.get(c.id) ?? [];
          const results = resultsByConn.get(c.id) ?? [];
          results.forEach((res, si) => {
            const key = pageMetaKey(c.id, si);
            pageCache[pageCacheKey(c.id, si, 0)] = res;
            pageCache = boundPageCache(pageCache, c.id, si, 0);
            const pageable = Boolean(pageSqlByConnection[c.id]?.[si]);
            pageMeta[key] = {
              pageIndex: 0,
              pageSize: maxRows,
              hasNext: pageable && Boolean(res.ok && (res.hasNext || res.truncated)),
            };
          });
        }
        set((state) => {
          const current = state.resultsByTab[tabId];
          if (!current) return state;
          return {
            resultsByTab: {
              ...state.resultsByTab,
              [tabId]: {
                ...current,
                pageCache,
                pageMeta,
                pageSqlByConnection,
              },
            },
            runningTabId: null,
          };
        });
      },

      loadResultPage: async ({ connectionId, statementIndex, pageIndex }) => {
        const { resultsByTab, activeTabId, maxRows, sessionPasswords, runningTabId } = get();
        const tabId = activeTabId;
        const current = resultsByTab[tabId];
        if (!current || runningTabId === tabId) return;
        const epoch = current.pageEpoch ?? 0;
        const metaKey = pageMetaKey(connectionId, statementIndex);
        const cacheKey = pageCacheKey(connectionId, statementIndex, pageIndex);
        const cached = current.pageCache?.[cacheKey];
        const pageSize = current.pageMeta?.[metaKey]?.pageSize ?? maxRows;
        const sql = current.pageSqlByConnection?.[connectionId]?.[statementIndex];
        if (!cached && !sql) return;

        const setMeta = (patch: Partial<ResultPageMeta>) =>
          set((state) => {
            const cur = state.resultsByTab[tabId];
            if (!cur || !isCurrentPageEpoch(epoch, cur.pageEpoch)) return state;
            const prev = cur.pageMeta?.[metaKey];
            return {
              resultsByTab: {
                ...state.resultsByTab,
                [tabId]: {
                  ...cur,
                  pageMeta: {
                    ...(cur.pageMeta ?? {}),
                    [metaKey]: {
                      pageIndex: prev?.pageIndex ?? 0,
                      hasNext: prev?.hasNext ?? false,
                      pageSize: prev?.pageSize ?? pageSize,
                      ...patch,
                    },
                  },
                },
              },
            };
          });

        const applyResult = (res: SqlStatementResult, hasNext: boolean) => {
          set((state) => {
            const cur = state.resultsByTab[tabId];
            if (!cur || !isCurrentPageEpoch(epoch, cur.pageEpoch)) return state;
            const merged = { ...(cur.pageCache ?? {}), [cacheKey]: res };
            const pageCache = boundPageCache(
              merged,
              connectionId,
              statementIndex,
              pageIndex
            );
            return {
              resultsByTab: {
                ...state.resultsByTab,
                [tabId]: {
                  ...cur,
                  pageCache,
                  pageMeta: {
                    ...(cur.pageMeta ?? {}),
                    [metaKey]: { pageIndex, hasNext, loading: false, pageSize },
                  },
                  // Keep only the current page on runs.results; pageCache holds revisits.
                  runs: cur.runs.map((r) => {
                    if (r.connectionId !== connectionId || !r.results) return r;
                    const results = [...r.results];
                    results[statementIndex] = res;
                    return { ...r, results };
                  }),
                },
              },
            };
          });
        };

        if (cached) {
          applyResult(cached, Boolean(cached.ok && (cached.hasNext || cached.truncated)));
          return;
        }

        setMeta({ loading: true });
        try {
          const offset = pageIndex * pageSize;
          const { results } = await executeSql(
            { connectionId, password: sessionPasswords[connectionId] || undefined },
            [sql!],
            pageSize,
            offset
          );
          const one = results[0] ?? {
            ok: false as const,
            error: 'No result returned',
            durationMs: 0,
          };
          applyResult(one, Boolean(one.ok && (one.hasNext || one.truncated)));
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          applyResult({ ok: false, error: msg, durationMs: 0 }, false);
        }
      },

      saveBookmark: (opts) => {
        const { tabs, activeTabId, bookmarks, shareDestinations, sharedConnectionIds } = get();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (!tab) return;
        const title = (opts?.title ?? tab.title).trim() || 'Bookmark';
        const selectedConnectionIds = [
          ...effectiveConnectionIds(tab, shareDestinations, sharedConnectionIds),
        ];
        const existing =
          (tab.bookmarkId ? bookmarks.find((b) => b.id === tab.bookmarkId) : undefined) ??
          bookmarks.find((b) => b.title.toLowerCase() === title.toLowerCase());
        const entry: SqlBookmark = {
          id: existing?.id ?? newTabId(),
          title,
          sql: tab.sql,
          selectedConnectionIds,
          updatedAt: Date.now(),
        };
        const next = existing
          ? bookmarks.map((b) => (b.id === existing.id ? entry : b))
          : [entry, ...bookmarks];
        set({
          bookmarks: next,
          tabs: tabs.map((t) =>
            t.id === activeTabId ? { ...t, bookmarkId: entry.id, title } : t
          ),
        });
      },

      openBookmark: (id) => {
        const { bookmarks, tabs, shareDestinations } = get();
        const bm = bookmarks.find((b) => b.id === id);
        if (!bm) return;
        // Reuse an open tab already linked to this bookmark.
        const existingTab = tabs.find((t) => t.bookmarkId === id);
        if (existingTab) {
          const patch: Partial<SqlEditorState> = { activeTabId: existingTab.id };
          if (shareDestinations) {
            patch.sharedConnectionIds = [...bm.selectedConnectionIds];
          }
          set(patch);
          return;
        }
        const tab = createTab({
          title: bm.title,
          sql: bm.sql,
          selectedConnectionIds: [...bm.selectedConnectionIds],
          bookmarkId: bm.id,
        });
        const patch: Partial<SqlEditorState> = {
          tabs: [...tabs, tab],
          activeTabId: tab.id,
        };
        if (shareDestinations) {
          patch.sharedConnectionIds = [...bm.selectedConnectionIds];
        }
        set(patch);
      },

      renameBookmark: (id, title) => {
        const trimmed = title.trim() || 'Bookmark';
        const { bookmarks, tabs } = get();
        set({
          bookmarks: bookmarks.map((b) =>
            b.id === id ? { ...b, title: trimmed, updatedAt: Date.now() } : b
          ),
          // Keep any open tab linked to this bookmark in sync.
          tabs: tabs.map((t) => (t.bookmarkId === id ? { ...t, title: trimmed } : t)),
        });
      },

      deleteBookmark: (id) => {
        set({
          bookmarks: get().bookmarks.filter((b) => b.id !== id),
          tabs: get().tabs.map((t) =>
            t.bookmarkId === id ? { ...t, bookmarkId: undefined } : t
          ),
        });
      },

      dataPeek: null,

      openDataPeek: async (connectionId, tableName) => {
        const conn = useSyncStore.getState().connections.find((c) => c.id === connectionId);
        if (!conn) return;
        const built = buildTablePreview(tableName, conn.dialect);
        const composed = composePeekSql(built.sql, built.params, {});
        if ('error' in composed) return;
        const entry: DataPeekEntry = {
          id: `peek-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: tableName,
          tableName,
          baseSql: built.sql,
          baseParams: built.params,
          whereClause: '',
          orderByClause: '',
          limit: DATA_PEEK_ROWS,
          pageIndex: 0,
          sql: composed.sql,
          params: composed.params,
          status: 'loading',
        };
        set({ dataPeek: { connectionId, dialect: conn.dialect, entries: [entry] } });
        await get().runDataPeekEntry(entry.id);
      },

      drillDataPeek: async (fromEntryId, fk, values) => {
        const peek = get().dataPeek;
        if (!peek) return;
        const built = buildForeignKeyDrilldown(fk, values, peek.dialect);
        if (!built) return;
        const composed = composePeekSql(built.sql, built.params, {});
        if ('error' in composed) return;
        const label = (fk.referencedColumns ?? [])
          .map((c, i) => `${c} = ${String(values[i])}`)
          .join(', ');
        const drillKey = dataPeekDrillKey(fromEntryId, fk);
        const entry: DataPeekEntry = {
          id: `peek-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: `${fk.referencedTable} · ${label}`,
          tableName: fk.referencedTable,
          baseSql: built.sql,
          baseParams: built.params,
          whereClause: '',
          orderByClause: '',
          limit: DATA_PEEK_ROWS,
          pageIndex: 0,
          sql: composed.sql,
          params: composed.params,
          status: 'loading',
          parentId: fromEntryId,
          drillKey,
        };
        // Same FK column → replace that panel (and its children). Other FK
        // columns from the same parent stay open as sibling peeks.
        let entries = peek.entries;
        const existing = entries.find((e) => e.drillKey === drillKey);
        if (existing) {
          entries = removeDataPeekSubtree(entries, existing.id);
        }
        set({ dataPeek: { ...peek, entries: [...entries, entry] } });
        await get().runDataPeekEntry(entry.id);
      },

      updateDataPeekFilters: async (entryId, patch) => {
        const peek = get().dataPeek;
        if (!peek) return;
        const entry = peek.entries.find((e) => e.id === entryId);
        if (!entry) return;
        const whereClause = patch.whereClause ?? entry.whereClause;
        const orderByClause = patch.orderByClause ?? entry.orderByClause;
        let limit = patch.limit ?? entry.limit;
        if (!Number.isFinite(limit) || limit < 1) limit = 1;
        limit = Math.min(5000, Math.floor(limit));
        const composed = composePeekSql(entry.baseSql, entry.baseParams, {
          where: whereClause,
          orderBy: orderByClause,
        });
        if ('error' in composed) {
          set({
            dataPeek: {
              ...peek,
              entries: peek.entries.map((e) =>
                e.id === entryId
                  ? {
                      ...e,
                      whereClause,
                      orderByClause,
                      limit,
                      pageIndex: 0,
                      status: 'error' as const,
                      error: composed.error,
                    }
                  : e
              ),
            },
          });
          return;
        }
        set({
          dataPeek: {
            ...peek,
            entries: peek.entries.map((e) =>
              e.id === entryId
                ? {
                    ...e,
                    whereClause,
                    orderByClause,
                    limit,
                    pageIndex: 0,
                    sql: composed.sql,
                    params: composed.params,
                    status: 'loading' as const,
                    error: undefined,
                  }
                : e
            ),
          },
        });
        await get().runDataPeekEntry(entryId);
      },

      setDataPeekPanelHeight: (entryId, heightPx) => {
        const peek = get().dataPeek;
        if (!peek) return;
        const clamped = Math.min(900, Math.max(220, Math.round(heightPx)));
        set({
          dataPeek: {
            ...peek,
            entries: peek.entries.map((e) =>
              e.id === entryId ? { ...e, panelHeightPx: clamped } : e
            ),
          },
        });
      },

      reorderDataPeekEntries: (fromIndex, toIndex) => {
        const peek = get().dataPeek;
        if (!peek) return;
        const entries = moveDataPeekEntry(peek.entries, fromIndex, toIndex);
        if (entries === peek.entries) return;
        set({ dataPeek: { ...peek, entries } });
      },

      pageDataPeekEntry: async (entryId, pageIndex) => {
        const peek = get().dataPeek;
        if (!peek) return;
        const entry = peek.entries.find((e) => e.id === entryId);
        if (!entry) return;
        const nextPage = Math.max(0, Math.floor(pageIndex));
        if (nextPage === entry.pageIndex && entry.status === 'ready') return;
        set({
          dataPeek: {
            ...peek,
            entries: peek.entries.map((e) =>
              e.id === entryId
                ? { ...e, pageIndex: nextPage, status: 'loading' as const, error: undefined }
                : e
            ),
          },
        });
        await get().runDataPeekEntry(entryId);
      },

      runDataPeekEntry: async (entryId) => {
        const peek = get().dataPeek;
        if (!peek) return;
        const entry = peek.entries.find((e) => e.id === entryId);
        if (!entry) return;
        const patch = (next: Partial<DataPeekEntry>) => {
          const cur = get().dataPeek;
          if (!cur) return;
          set({
            dataPeek: {
              ...cur,
              entries: cur.entries.map((e) => (e.id === entryId ? { ...e, ...next } : e)),
            },
          });
        };
        try {
          const pageSize = Math.min(5000, Math.max(1, entry.limit || DATA_PEEK_ROWS));
          const pageIndex = Math.max(0, entry.pageIndex || 0);
          const offset = pageIndex * pageSize;
          const { results } = await executeSql(
            {
              connectionId: peek.connectionId,
              password: get().sessionPasswords[peek.connectionId] || undefined,
            },
            [entry.sql],
            pageSize,
            offset,
            [entry.params]
          );
          const result = results[0];
          if (!result) {
            patch({ status: 'error', error: 'No result returned' });
            return;
          }
          patch(
            result.ok
              ? { status: 'ready', result }
              : { status: 'error', error: result.error, result }
          );
        } catch (error: unknown) {
          patch({ status: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      },

      closeDataPeek: () => set({ dataPeek: null }),

      closeDataPeekFrom: (entryId) => {
        const peek = get().dataPeek;
        if (!peek) return;
        const target = peek.entries.find((e) => e.id === entryId);
        if (!target) return;
        // Closing the root dismisses the whole peek.
        if (!target.parentId) {
          set({ dataPeek: null });
          return;
        }
        set({
          dataPeek: {
            ...peek,
            entries: removeDataPeekSubtree(peek.entries, entryId),
          },
        });
      },

      installSampleBookmarks: () => {
        const samples = buildSampleBookmarks();
        const { bookmarks } = get();
        const sampleIds = new Set(samples.map((s) => s.id));
        const prevById = new Map(bookmarks.map((b) => [b.id, b]));
        let touched = 0;
        for (const sample of samples) {
          const prev = prevById.get(sample.id);
          if (!prev || prev.sql !== sample.sql || prev.title !== sample.title) {
            touched += 1;
          }
        }
        // Keep user bookmarks first; samples at the end so they stay easy to find.
        const user = bookmarks.filter((b) => !sampleIds.has(b.id));
        set({ bookmarks: [...user, ...samples] });
        return touched;
      },

      upsertVariable: (input) => {
        const name = normalizeVariableName(input.name);
        if (!isValidVariableName(name)) {
          return 'Name must match [A-Za-z_][A-Za-z0-9_]*';
        }
        const allowEmptyList = input.secret === true;
        if (
          input.kind === 'list' &&
          (!input.values || input.values.length === 0) &&
          !allowEmptyList
        ) {
          return 'List variable needs at least one value';
        }
        if (input.kind === 'table' && (!input.columns || input.columns.length === 0)) {
          return 'Table variable needs columns';
        }
        const { variables } = get();
        const byId = input.id ? variables.find((v) => v.id === input.id) : undefined;
        const nameClash = variables.find(
          (v) => v.name === name && (!byId || v.id !== byId.id)
        );
        const existing = byId ?? (!input.id ? nameClash : undefined);
        const makeEntry = (id: string): SqlVariable => ({
          id,
          name,
          kind: input.kind,
          value: input.kind === 'scalar' ? input.value : undefined,
          values: input.kind === 'list' ? [...(input.values ?? [])] : undefined,
          columns: input.kind === 'table' ? [...(input.columns ?? [])] : undefined,
          rows:
            input.kind === 'table'
              ? (input.rows ?? []).map((r) => [...r])
              : undefined,
          secret: input.secret !== undefined ? input.secret : existing?.secret,
          overrides:
            input.overrides !== undefined
              ? input.overrides
              : existing?.overrides
                ? { ...existing.overrides }
                : undefined,
          updatedAt: Date.now(),
        });
        if (nameClash && !byId) {
          const entry = makeEntry(nameClash.id);
          set({
            variables: variables.map((v) => (v.id === nameClash.id ? entry : v)),
          });
          return null;
        }
        if (nameClash && byId) {
          return `Variable "${name}" already exists`;
        }
        if (byId) {
          const entry = makeEntry(byId.id);
          set({
            variables: variables.map((v) => (v.id === byId.id ? entry : v)),
          });
          return null;
        }
        set({ variables: [makeEntry(newTabId()), ...variables] });
        return null;
      },

      deleteVariable: (id) => {
        set({ variables: get().variables.filter((v) => v.id !== id) });
      },

      setVariableSecret: (id, secret) => {
        set({
          variables: get().variables.map((v) =>
            v.id === id ? { ...v, secret, updatedAt: Date.now() } : v
          ),
        });
      },

      setVariableOverride: (id, connectionId, override) => {
        set({
          variables: get().variables.map((v) => {
            if (v.id !== id || v.kind === 'table') return v;
            const next = { ...(v.overrides ?? {}) };
            if (override === null) {
              delete next[connectionId];
            } else {
              next[connectionId] = override;
            }
            return {
              ...v,
              overrides: Object.keys(next).length > 0 ? next : undefined,
              updatedAt: Date.now(),
            };
          }),
        });
      },

      exportVariablesJson: () =>
        JSON.stringify(exportVariables(get().variables), null, 2),

      importVariables: (raw, opts) => {
        const parsed = parseImportedVariables(raw);
        if (!parsed.ok) return parsed.error;
        const overwrite = opts?.overwrite !== false;
        for (const item of parsed.items) {
          const existing = get().variables.find((v) => v.name === item.name);
          if (existing && !overwrite) continue;
          if (item.secret) {
            const err = get().upsertVariable({
              id: existing?.id,
              name: item.name,
              kind: item.kind,
              secret: true,
              value: item.kind === 'scalar' ? undefined : undefined,
              values: item.kind === 'list' ? [] : undefined,
              columns: item.kind === 'table' ? item.columns ?? existing?.columns ?? ['col'] : undefined,
              rows: item.kind === 'table' ? [] : undefined,
            });
            if (err) return err;
            continue;
          }
          const err = get().upsertVariable({
            id: existing?.id,
            name: item.name,
            kind: item.kind,
            secret: false,
            value: item.value,
            values: item.values,
            columns: item.columns,
            rows: item.rows,
            overrides: item.overrides,
          });
          if (err) return err;
        }
        return null;
      },
    }),
    {
      name: 'foxschema-sql-editor',
      version: 6,
      // Persist tabs + destinations mode + bookmarks + variables. Never passwords/results.
      // Secret variable payloads are stripped (session-only values).
      partialize: (state) => {
        const tabs = persistableTabs(state.tabs).map((t) => ({
          ...t,
          sql: truncatePersistedSql(t.sql),
        }));
        const bookmarks = [...state.bookmarks]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_PERSISTED_BOOKMARKS)
          .map((b) => ({ ...b, sql: truncatePersistedSql(b.sql) }));
        return {
          tabs,
          activeTabId: state.activeTabId,
          maxRows: state.maxRows,
          safeMode: state.safeMode,
          shareDestinations: state.shareDestinations,
          sharedConnectionIds: state.sharedConnectionIds,
          bookmarks,
          variables: stripSecretsForPersist(state.variables),
        };
      },
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        // v1: flat { sql, selectedConnectionIds, maxRows }
        if (fromVersion < 2) {
          const tab = createTab({
            title: 'Query 1',
            sql: typeof p.sql === 'string' ? p.sql : '',
            selectedConnectionIds: Array.isArray(p.selectedConnectionIds)
              ? (p.selectedConnectionIds as string[])
              : [],
          });
          return {
            tabs: [tab],
            activeTabId: tab.id,
            maxRows: typeof p.maxRows === 'number' ? p.maxRows : 200,
            safeMode: true,
            shareDestinations: true,
            sharedConnectionIds: Array.isArray(p.selectedConnectionIds)
              ? (p.selectedConnectionIds as string[])
              : [],
            bookmarks: [],
            variables: [],
          };
        }
        if (fromVersion < 3) {
          const tabs = Array.isArray(p.tabs) ? p.tabs : [];
          const first = tabs[0] as { selectedConnectionIds?: string[] } | undefined;
          return {
            ...p,
            safeMode: true,
            shareDestinations: true,
            sharedConnectionIds: Array.isArray(first?.selectedConnectionIds)
              ? first.selectedConnectionIds
              : [],
            bookmarks: [],
            variables: [],
          };
        }
        if (fromVersion < 4) {
          return { ...p, variables: [] };
        }
        // v5: secret/overrides fields are optional; strip any leaked secret payloads.
        if (fromVersion < 5) {
          const vars = Array.isArray(p.variables) ? (p.variables as SqlVariable[]) : [];
          return { ...p, variables: stripSecretsForPersist(vars) };
        }
        // v6: table-blueprint / composite-FK era — keep editor persist stable; coerce
        // arrays so older partial blobs still hydrate. Schema FK shapes are normalized
        // server-side via normalizeTableSchemas (not stored in this persist key).
        if (fromVersion < 6) {
          const vars = Array.isArray(p.variables) ? (p.variables as SqlVariable[]) : [];
          return {
            ...p,
            tabs: Array.isArray(p.tabs) ? p.tabs : [],
            bookmarks: Array.isArray(p.bookmarks) ? p.bookmarks : [],
            sharedConnectionIds: Array.isArray(p.sharedConnectionIds)
              ? p.sharedConnectionIds
              : [],
            variables: stripSecretsForPersist(vars),
            safeMode: typeof p.safeMode === 'boolean' ? p.safeMode : true,
            shareDestinations:
              typeof p.shareDestinations === 'boolean' ? p.shareDestinations : true,
            maxRows: typeof p.maxRows === 'number' ? p.maxRows : 200,
          };
        }
        return p;
      },
      // Always rehydrate checkedStatements (not persisted) and drop malformed tabs.
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') return currentState;
        const p = persistedState as {
          tabs?: Array<Partial<SqlTab> & Pick<SqlTab, 'id'>>;
          activeTabId?: string;
          maxRows?: number;
          safeMode?: boolean;
          shareDestinations?: boolean;
          sharedConnectionIds?: string[];
          bookmarks?: SqlBookmark[];
          variables?: SqlVariable[];
        };
        const tabs = hydrateTabs(Array.isArray(p.tabs) ? p.tabs : []);
        const activeTabId =
          typeof p.activeTabId === 'string' && tabs.some((t) => t.id === p.activeTabId)
            ? p.activeTabId
            : tabs[0]!.id;
        const bookmarks = Array.isArray(p.bookmarks)
          ? p.bookmarks
              .filter(
                (b) =>
                  b &&
                  typeof b.id === 'string' &&
                  typeof b.title === 'string' &&
                  typeof b.sql === 'string'
              )
              .map((b) => ({ ...b, sql: truncatePersistedSql(b.sql) }))
              .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
              .slice(0, MAX_PERSISTED_BOOKMARKS)
          : [];

        // Relink tabs↔bookmarks by unique SQL match, and sync bookmark title to the tab.
        const healedTabs = tabs.map((t) => {
          const capped = { ...t, sql: truncatePersistedSql(t.sql) };
          if (capped.bookmarkId && bookmarks.some((b) => b.id === capped.bookmarkId)) return capped;
          const matches = bookmarks.filter((b) => b.sql === capped.sql);
          if (matches.length !== 1) return capped;
          return { ...capped, bookmarkId: matches[0]!.id };
        });
        const healedBookmarks = bookmarks.map((b) => {
          const tab = healedTabs.find((t) => t.bookmarkId === b.id);
          if (!tab || tab.title === b.title) return b;
          return { ...b, title: tab.title, updatedAt: Date.now() };
        });

        const variables = stripSecretsForPersist(
          Array.isArray(p.variables)
            ? p.variables.filter(
                (v) =>
                  v &&
                  typeof v.id === 'string' &&
                  typeof v.name === 'string' &&
                  isValidVariableName(v.name) &&
                  (v.kind === 'scalar' || v.kind === 'list' || v.kind === 'table')
              )
            : []
        );

        return {
          ...currentState,
          tabs: healedTabs,
          activeTabId,
          maxRows: typeof p.maxRows === 'number' ? p.maxRows : currentState.maxRows,
          safeMode: typeof p.safeMode === 'boolean' ? p.safeMode : true,
          shareDestinations:
            typeof p.shareDestinations === 'boolean' ? p.shareDestinations : true,
          sharedConnectionIds: Array.isArray(p.sharedConnectionIds)
            ? p.sharedConnectionIds.filter((id) => typeof id === 'string')
            : [],
          bookmarks: healedBookmarks,
          variables,
        };
      },
    }
  )
);
