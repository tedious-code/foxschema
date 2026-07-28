import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { executeSql, type SqlStatementResult } from '../api/sqlApi';
import { resolveAppSecrets } from '../api/appSecretsApi';
import { loadSchema } from '../api/schemaApi';
import { isMutatingDmlStatement, isWriteStatement, splitSqlStatements } from '../lib/sql-splitter';
import type { CodeCellLast } from '../lib/codeCellExec';
import { detectCodeCell, runCodeCell } from '../lib/codeCellRunner';
import { buildSampleBookmarks } from '../lib/sqlEditorSamples';
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
  effectiveConnectionIds,
  hydrateTabs,
  moveTab as moveTabLogic,
  newTabId,
  persistableTabs,
  statementsFromSelection,
  statementsToRun,
  toggleStatementCheck,
  type ResultsLayout,
  type SqlTab,
} from './sqlEditorTabLogic';

export type { SqlVariable, SqlVariableKind, SqlVariableExport, VariableOverride };

/** Dialects whose adapters are SELECT-only — writes fail with a friendly error. */
const READONLY_DIALECTS = new Set(['sqlite', 'clickhouse']);

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
}

export interface ReadonlyWriteTarget {
  name: string;
  dialect: string;
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
  /** Re-run SQL. Pass `connectionIds` to refresh only those credentials (keeps other panes). */
  execute: (opts?: { confirmedWrites?: boolean; connectionIds?: string[] }) => Promise<void>;
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
          const ids = current.filter((x) => x !== id);
          if (shareDestinations) {
            set({ sharedConnectionIds: ids });
          } else {
            set({
              tabs: tabs.map((t) =>
                t.id === activeTabId ? { ...t, selectedConnectionIds: ids } : t
              ),
            });
          }
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

        const ids = [...current, id];
        if (shareDestinations) {
          set({ sharedConnectionIds: ids });
        } else {
          set({
            tabs: tabs.map((t) =>
              t.id === activeTabId ? { ...t, selectedConnectionIds: ids } : t
            ),
          });
        }
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
        const { id, resumeExecute, connectionIds } = pendingPassword;

        let nextShared = sharedConnectionIds;
        let nextTabs = tabs;
        if (shareDestinations) {
          if (!sharedConnectionIds.includes(id)) {
            nextShared = [...sharedConnectionIds, id];
          }
        } else {
          nextTabs = tabs.map((t) => {
            if (t.id !== activeTabId) return t;
            if (t.selectedConnectionIds.includes(id)) return t;
            return { ...t, selectedConnectionIds: [...t.selectedConnectionIds, id] };
          });
        }

        set({
          sessionPasswords: { ...get().sessionPasswords, [id]: password },
          tabs: nextTabs,
          sharedConnectionIds: nextShared,
          pendingPassword: null,
        });
        if (resumeExecute) {
          void get().execute(connectionIds?.length ? { connectionIds } : undefined);
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

      execute: async ({ confirmedWrites = false, connectionIds } = {}) => {
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
        const connections =
          connectionIds && connectionIds.length > 0
            ? selected.filter((c) => connectionIds.includes(c.id))
            : selected;
        if (connections.length === 0) return;

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
            },
          });
          return;
        }

        const selectedSql = getSelectedSql();
        const rawStatements = selectedSql
          ? statementsFromSelection(selectedSql)
          : statementsToRun(tab.sql, tab.checkedStatements);
        if (rawStatements.length === 0) return;

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

        const setRanStatements = (stmts: string[]) =>
          set((state) => {
            const current = state.resultsByTab[tabId];
            if (!current) return state;
            return {
              resultsByTab: {
                ...state.resultsByTab,
                [tabId]: { ...current, ranStatements: stmts },
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
            setRanStatements([...ranDisplay]);

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
          setRanStatements([...ranDisplay]);

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
