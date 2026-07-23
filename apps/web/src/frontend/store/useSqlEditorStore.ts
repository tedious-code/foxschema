import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { executeSql, type SqlStatementResult } from '../api/sqlApi';
import { loadSchema } from '../api/schemaApi';
import { isMutatingDmlStatement, isWriteStatement } from '../lib/sql-splitter';
import { useSyncStore } from './useSyncStore';
import type { SchemaCacheEntry } from '../components/sql-editor/sqlEditorBridge';
import {
  addTab as addTabLogic,
  checkedAfterSqlChange,
  closeTab as closeTabLogic,
  createTab,
  effectiveConnectionIds,
  hydrateTabs,
  newTabId,
  persistableTabs,
  statementsToRun,
  toggleStatementCheck,
  type ResultsLayout,
  type SqlTab,
} from './sqlEditorTabLogic';

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

  activeTab: () => SqlTab;
  /** Destination server ids for the active tab (respects shareDestinations). */
  activeConnectionIds: () => string[];
  setSql: (sql: string) => void;
  toggleConnection: (id: string) => void;
  setShareDestinations: (share: boolean) => void;
  setSafeMode: (on: boolean) => void;
  toggleStatement: (index: number) => void;
  setLayout: (layout: ResultsLayout) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  submitSessionPassword: (password: string) => void;
  cancelPasswordPrompt: () => void;
  setMaxRows: (n: number) => void;
  ensureSchema: (connectionId: string, opts?: { force?: boolean }) => Promise<void>;
  /** Re-run SQL. Pass `connectionIds` to refresh only those credentials (keeps other panes). */
  execute: (opts?: { confirmedWrites?: boolean; connectionIds?: string[] }) => Promise<void>;
  cancelWriteConfirm: () => void;
  clearResults: () => void;
  saveBookmark: (opts?: { title?: string }) => void;
  openBookmark: (id: string) => void;
  renameBookmark: (id: string, title: string) => void;
  deleteBookmark: (id: string) => void;
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
            return {
              ...t,
              sql,
              checkedStatements: checkedAfterSqlChange(t.sql, sql, t.checkedStatements),
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
        const { tabs, activeTabId, sessionPasswords, shareDestinations, sharedConnectionIds } =
          get();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (!tab) return;

        const current = shareDestinations ? sharedConnectionIds : tab.selectedConnectionIds;
        const selected = current.includes(id);

        const applyIds = (ids: string[]) => {
          if (shareDestinations) {
            set({ sharedConnectionIds: ids });
          } else {
            set({
              tabs: tabs.map((t) =>
                t.id === activeTabId ? { ...t, selectedConnectionIds: ids } : t
              ),
            });
          }
        };

        if (selected) {
          applyIds(current.filter((x) => x !== id));
          return;
        }

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

        applyIds([...current, id]);
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
        const existing = get().schemaCache[connectionId];
        if (!force && (existing?.status === 'ready' || existing?.status === 'loading')) return;

        const conn = useSyncStore.getState().connections.find((c) => c.id === connectionId);
        if (!conn) {
          set({
            schemaCache: {
              ...get().schemaCache,
              [connectionId]: { status: 'error', error: 'Connection not found' },
            },
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
            schemaCache: {
              ...get().schemaCache,
              [connectionId]: {
                status: 'error',
                error: 'Password required — enter it when prompted, then reload schema.',
              },
            },
          });
          return;
        }

        set({
          schemaCache: {
            ...get().schemaCache,
            [connectionId]: { status: 'loading', tables: existing?.tables },
          },
        });

        try {
          const { tables } = await loadSchema(
            { connectionId, password: sessionPasswords[connectionId] || undefined },
            ['TABLE', 'VIEW', 'MQT']
          );
          set({
            schemaCache: {
              ...get().schemaCache,
              [connectionId]: { status: 'ready', tables },
            },
          });
        } catch (error: unknown) {
          set({
            schemaCache: {
              ...get().schemaCache,
              [connectionId]: {
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
              },
            },
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

        const statements = statementsToRun(tab.sql, tab.checkedStatements);
        if (statements.length === 0) return;

        // Safe mode: confirm UPDATE / DELETE / MERGE (and other writes) before run.
        const writeStatements = statements.filter((s) => isWriteStatement(s));
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

        set({
          pendingWriteConfirm: null,
          runningTabId: tabId,
          resultsByTab: {
            ...get().resultsByTab,
            [tabId]: {
              ranStatements: statements,
              runs: nextRuns,
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

        await Promise.allSettled(
          connections.map(async (c) => {
            try {
              const { results } = await executeSql(
                { connectionId: c.id, password: sessionPasswords[c.id] || undefined },
                statements,
                maxRows
              );
              patchRun(c.id, { status: 'done', results, error: undefined });
            } catch (error: unknown) {
              patchRun(c.id, {
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
                results: undefined,
              });
            }
          })
        );

        set({ runningTabId: null });
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
    }),
    {
      name: 'foxschema-sql-editor',
      version: 3,
      // Persist tabs + destinations mode + bookmarks. Never passwords/results.
      partialize: (state) => ({
        tabs: persistableTabs(state.tabs),
        activeTabId: state.activeTabId,
        maxRows: state.maxRows,
        safeMode: state.safeMode,
        shareDestinations: state.shareDestinations,
        sharedConnectionIds: state.sharedConnectionIds,
        bookmarks: state.bookmarks,
      }),
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
        };
        const tabs = hydrateTabs(Array.isArray(p.tabs) ? p.tabs : []);
        const activeTabId =
          typeof p.activeTabId === 'string' && tabs.some((t) => t.id === p.activeTabId)
            ? p.activeTabId
            : tabs[0]!.id;
        const bookmarks = Array.isArray(p.bookmarks)
          ? p.bookmarks.filter(
              (b) =>
                b &&
                typeof b.id === 'string' &&
                typeof b.title === 'string' &&
                typeof b.sql === 'string'
            )
          : [];

        // Relink tabs↔bookmarks by unique SQL match, and sync bookmark title to the tab.
        const healedTabs = tabs.map((t) => {
          if (t.bookmarkId && bookmarks.some((b) => b.id === t.bookmarkId)) return t;
          const matches = bookmarks.filter((b) => b.sql === t.sql);
          if (matches.length !== 1) return t;
          return { ...t, bookmarkId: matches[0]!.id };
        });
        const healedBookmarks = bookmarks.map((b) => {
          const tab = healedTabs.find((t) => t.bookmarkId === b.id);
          if (!tab || tab.title === b.title) return b;
          return { ...b, title: tab.title, updatedAt: Date.now() };
        });

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
        };
      },
    }
  )
);
