/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Utilities → Index Management: list indexes grouped by table, fetch
 * fragmentation via a credential, filter by table / %, defragment selected
 * or all matching indexes.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Database,
  Loader2,
  RefreshCw,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import {
  buildIndexDefragSql,
  dialectSupportsIndexFragmentation,
  fragmentationSeverity,
} from '@foxschema/core';
import {
  fetchIndexFragmentationBatch,
  matchIndexFragmentationRow,
  type IndexFragmentationApiRow,
} from '../../api/schemaApi';
import { executeSql } from '../../api/sqlApi';
import { useSyncStore } from '../../store/useSyncStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import type { IndexInfo, TableSchema } from '../../lib/types';
import { PROVIDER_SETTINGS } from '../../lib/provider-settings';

interface Props {
  open: boolean;
  onClose: () => void;
}

type IndexRow = {
  key: string;
  tableName: string;
  index: IndexInfo;
  frag: IndexFragmentationApiRow | null;
  defragSql: string[];
  tableError?: string;
};

function formatPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

function fragClass(severity: ReturnType<typeof fragmentationSeverity>): string {
  if (severity === 'ok') return 'text-emerald-300';
  if (severity === 'warn') return 'text-amber-300';
  if (severity === 'critical') return 'text-rose-300';
  return 'text-slate-400';
}

const LS_CONN = 'foxschema-utilities-index-mgmt-connection';

/** Utilities modal: credentials → indexes by table → filter → defragment. */
export const IndexManagementModal: React.FC<Props> = ({ open, onClose }) => {
  const connections = useSyncStore((s) => s.connections);
  const ensureSchema = useSqlEditorStore((s) => s.ensureSchema);
  const ensureConnectionSelected = useSqlEditorStore((s) => s.ensureConnectionSelected);
  const submitSessionPassword = useSqlEditorStore((s) => s.submitSessionPassword);
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const schemaCache = useSqlEditorStore((s) => s.schemaCache);
  const safeMode = useSqlEditorStore((s) => s.safeMode);

  const [connectionId, setConnectionId] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [minFragPct, setMinFragPct] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [fragByKey, setFragByKey] = useState<
    Record<string, { frag: IndexFragmentationApiRow | null; defragSql: string[]; tableError?: string }>
  >({});
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [loadingFrag, setLoadingFrag] = useState(false);
  const [runningDefrag, setRunningDefrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDefrag, setConfirmDefrag] = useState<'selected' | 'filtered' | null>(null);

  const initOpen = React.useRef(false);
  useEffect(() => {
    if (!open) {
      initOpen.current = false;
      return;
    }
    if (initOpen.current) return;
    initOpen.current = true;
    const saved = localStorage.getItem(LS_CONN) || '';
    const fallback = connections[0]?.id || '';
    const next = connections.some((c) => c.id === saved) ? saved : fallback;
    setConnectionId(next);
    setError(null);
    setStatus(null);
    setFragByKey({});
    setSelected(new Set());
  }, [open, connections]);

  const conn = connections.find((c) => c.id === connectionId) || null;
  const needsPassword = Boolean(conn && !conn.hasPassword && !sessionPasswords[connectionId]);
  const cache = connectionId ? schemaCache[connectionId] : undefined;
  const fragSupport = useMemo(
    () => dialectSupportsIndexFragmentation(conn?.dialect || ''),
    [conn?.dialect]
  );

  const tablesWithIndexes: TableSchema[] = useMemo(() => {
    const tables = cache?.tables ?? [];
    return tables
      .filter((t) => t.objectType === 'TABLE' || t.objectType === 'MQT')
      .filter((t) => (t.indices?.length ?? 0) > 0)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cache?.tables]);

  const allRows: IndexRow[] = useMemo(() => {
    const dialect = conn?.dialect || '';
    const schema = conn?.schema?.trim() || '';
    const rows: IndexRow[] = [];
    for (const table of tablesWithIndexes) {
      for (const index of table.indices ?? []) {
        const key = `${table.name}::${index.name}`;
        const hit = fragByKey[key];
        const frag = hit?.frag ?? null;
        const defragSql =
          hit?.defragSql?.length
            ? hit.defragSql
            : buildIndexDefragSql({
                dialect,
                schema,
                table: table.name,
                indexName: index.name,
                fragmentationPercent: frag?.fragmentationPercent,
              });
        rows.push({
          key,
          tableName: table.name,
          index,
          frag,
          defragSql,
          tableError: hit?.tableError,
        });
      }
    }
    return rows;
  }, [tablesWithIndexes, fragByKey, conn?.dialect, conn?.schema]);

  const filteredRows = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const minPct = minFragPct.trim() === '' ? null : Number(minFragPct);
    return allRows.filter((row) => {
      if (q && !row.tableName.toLowerCase().includes(q) && !row.index.name.toLowerCase().includes(q)) {
        return false;
      }
      if (minPct != null && Number.isFinite(minPct)) {
        const pct = row.frag?.fragmentationPercent;
        if (pct == null || !Number.isFinite(pct) || pct < minPct) return false;
      }
      return true;
    });
  }, [allRows, tableFilter, minFragPct]);

  const grouped = useMemo(() => {
    const map = new Map<string, IndexRow[]>();
    for (const row of filteredRows) {
      const list = map.get(row.tableName) ?? [];
      list.push(row);
      map.set(row.tableName, list);
    }
    return [...map.entries()];
  }, [filteredRows]);

  const applyFragBatch = useCallback(
    (
      results: Awaited<ReturnType<typeof fetchIndexFragmentationBatch>>['results'],
      dialect: string,
      schema: string | undefined,
      tables: TableSchema[]
    ) => {
      const next: typeof fragByKey = {};
      let okTables = 0;
      let failTables = 0;
      for (const result of results) {
        if (!result.ok) {
          failTables += 1;
          const table = tables.find((t) => t.name === result.table);
          for (const index of table?.indices ?? []) {
            next[`${result.table}::${index.name}`] = {
              frag: null,
              defragSql: buildIndexDefragSql({
                dialect,
                schema,
                table: result.table,
                indexName: index.name,
              }),
              tableError: result.error,
            };
          }
          continue;
        }
        okTables += 1;
        const table = tables.find((t) => t.name === result.table);
        for (const index of table?.indices ?? []) {
          const frag = matchIndexFragmentationRow(index.name, result.rows);
          const defragKey =
            (frag && (result.defrag[frag.indexName] || result.defrag[frag.indexName.toLowerCase()])) ||
            result.defrag[index.name] ||
            result.defrag[index.name.toLowerCase()];
          const defragSql =
            defragKey ??
            buildIndexDefragSql({
              dialect,
              schema,
              table: result.table,
              indexName: index.name,
              fragmentationPercent: frag?.fragmentationPercent,
            });
          next[`${result.table}::${index.name}`] = { frag, defragSql };
        }
      }
      setFragByKey(next);
      return { okTables, failTables };
    },
    []
  );

  const fetchFragmentation = useCallback(
    async (tables = tablesWithIndexes) => {
      if (!connectionId || !conn) return;
      if (needsPassword) {
        setError('Enter the session password for this credential first.');
        return;
      }
      const tableNames = tables.map((t) => t.name);
      if (tableNames.length === 0) {
        setError('No indexed tables in the loaded schema — click Load indexes first.');
        return;
      }
      setLoadingFrag(true);
      setError(null);
      setStatus(null);
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < tableNames.length; i += 80) {
          chunks.push(tableNames.slice(i, i + 80));
        }
        const allResults: Awaited<ReturnType<typeof fetchIndexFragmentationBatch>>['results'] =
          [];
        for (const chunk of chunks) {
          const batch = await fetchIndexFragmentationBatch(
            {
              connectionId,
              password: sessionPasswords[connectionId] || undefined,
              schema: conn.schema?.trim() || undefined,
            },
            { tables: chunk, schema: conn.schema?.trim() || undefined }
          );
          allResults.push(...batch.results);
        }
        const { okTables, failTables } = applyFragBatch(
          allResults,
          conn.dialect,
          conn.schema,
          tables
        );
        setStatus(
          `Fragmentation loaded for ${okTables} table(s)` +
            (failTables ? `; ${failTables} failed` : '') +
            `. ${fragSupport.hint}`
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingFrag(false);
      }
    },
    [
      connectionId,
      conn,
      needsPassword,
      tablesWithIndexes,
      sessionPasswords,
      fragSupport.hint,
      applyFragBatch,
    ]
  );

  const loadSchema = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!connectionId) return;
      setLoadingSchema(true);
      setError(null);
      setStatus(null);
      try {
        ensureConnectionSelected(connectionId);
        await ensureSchema(connectionId, { force: opts?.force ?? true });
        const entry = useSqlEditorStore.getState().schemaCache[connectionId];
        if (entry?.status === 'error') {
          setError(entry.error || 'Failed to load schema');
          return;
        }
        const tables = (entry?.tables ?? [])
          .filter((t) => t.objectType === 'TABLE' || t.objectType === 'MQT')
          .filter((t) => (t.indices?.length ?? 0) > 0)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        const n = tables.reduce((acc, t) => acc + (t.indices?.length ?? 0), 0);
        setStatus(`Loaded ${n} index(es) from schema catalog.`);
        setExpanded(new Set(tables.slice(0, 12).map((t) => t.name)));
        setLoadingSchema(false);
        // Same path as Edit Table: load % automatically so Utilities is not empty.
        if (tables.length > 0 && conn && !needsPassword) {
          await fetchFragmentation(tables);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingSchema(false);
      }
    },
    [
      connectionId,
      ensureConnectionSelected,
      ensureSchema,
      conn,
      needsPassword,
      fetchFragmentation,
    ]
  );

  // On open (and when the credential changes), load indexes + fragmentation —
  // Edit Table already auto-refreshes %; Utilities must too.
  const lastAutoKey = React.useRef('');
  useEffect(() => {
    if (!open) {
      lastAutoKey.current = '';
      return;
    }
    if (!connectionId || needsPassword) {
      // Allow a retry once the session password is saved.
      if (needsPassword) lastAutoKey.current = '';
      return;
    }
    const key = connectionId;
    if (lastAutoKey.current === key) return;
    lastAutoKey.current = key;
    void loadSchema({ force: false });
  }, [open, connectionId, needsPassword, loadSchema]);

  const runDefrag = useCallback(
    async (keys: string[]) => {
      if (!connectionId || !conn || keys.length === 0) return;
      if (needsPassword) {
        setError('Enter the session password for this credential first.');
        return;
      }
      const statements: string[] = [];
      const seen = new Set<string>();
      for (const key of keys) {
        const row = allRows.find((r) => r.key === key);
        if (!row?.defragSql.length) continue;
        for (const stmt of row.defragSql) {
          if (stmt.trim().startsWith('--')) continue;
          if (seen.has(stmt)) continue;
          seen.add(stmt);
          statements.push(stmt);
        }
      }
      if (statements.length === 0) {
        setError('No defragment SQL available for the selection.');
        return;
      }
      setRunningDefrag(true);
      setError(null);
      setStatus(null);
      try {
        const { results } = await executeSql(
          {
            connectionId,
            password: sessionPasswords[connectionId] || undefined,
          },
          statements
        );
        const failed = results.filter((r) => !r.ok);
        if (failed.length) {
          setError(
            failed
              .map((r) => ('error' in r ? r.error : 'failed'))
              .slice(0, 3)
              .join(' · ')
          );
        } else {
          setStatus(`Defragmented ${statements.length} statement(s) successfully.`);
          setSelected(new Set());
          void fetchFragmentation();
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunningDefrag(false);
        setConfirmDefrag(null);
      }
    },
    [
      connectionId,
      conn,
      needsPassword,
      allRows,
      sessionPasswords,
      fetchFragmentation,
    ]
  );

  const toggleExpand = (table: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredKeys = filteredRows.map((r) => r.key);
  const allFilteredSelected =
    filteredKeys.length > 0 && filteredKeys.every((k) => selected.has(k));

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      data-testid="index-management-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/50 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400" />
              Index Management
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Utilities — list indexes by table, fetch fragmentation, defragment selected or all
              filtered.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-800 space-y-2.5 shrink-0 bg-slate-950/30">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 min-w-[14rem] flex-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Credential
              </span>
              <select
                data-testid="index-mgmt-connection"
                value={connectionId}
                onChange={(e) => {
                  const id = e.target.value;
                  setConnectionId(id);
                  localStorage.setItem(LS_CONN, id);
                  setFragByKey({});
                  setSelected(new Set());
                  setPasswordDraft('');
                  setError(null);
                }}
                className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500"
              >
                <option value="">— Select credential —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{(PROVIDER_SETTINGS[c.dialect.toLowerCase()]?.label ?? c.dialect).toUpperCase()}]{' '}
                    {c.name}
                    {c.schema ? ` · ${c.schema}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {needsPassword && (
              <label className="flex flex-col gap-1 min-w-[10rem]">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Session password
                </span>
                <div className="flex gap-1">
                  <input
                    type="password"
                    data-testid="index-mgmt-password"
                    value={passwordDraft}
                    onChange={(e) => setPasswordDraft(e.target.value)}
                    placeholder="••••••••"
                    className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 font-mono w-36"
                  />
                  <button
                    type="button"
                    className="px-2.5 py-1.5 text-xs font-bold rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-100"
                    onClick={() => {
                      if (!connectionId || !passwordDraft) return;
                      // ensureConnectionSelected sets pendingPassword; submit stores it.
                      ensureConnectionSelected(connectionId);
                      submitSessionPassword(passwordDraft);
                      setPasswordDraft('');
                    }}
                  >
                    Save
                  </button>
                </div>
              </label>
            )}
            <button
              type="button"
              data-testid="index-mgmt-load"
              disabled={!connectionId || loadingSchema || needsPassword}
              onClick={() => void loadSchema({ force: true })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingSchema ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Load indexes
            </button>
            <button
              type="button"
              data-testid="index-mgmt-fetch-frag"
              disabled={!connectionId || loadingFrag || tablesWithIndexes.length === 0 || needsPassword}
              onClick={() => void fetchFragmentation()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
            >
              {loadingFrag ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Fetch fragmentation
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 min-w-[12rem] flex-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Filter table / index
              </span>
              <input
                data-testid="index-mgmt-table-filter"
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                placeholder="e.g. ORDER"
                className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 font-mono"
              />
            </label>
            <label className="flex flex-col gap-1 w-36">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Min frag %
              </span>
              <input
                data-testid="index-mgmt-min-frag"
                type="number"
                min={0}
                max={100}
                step={1}
                value={minFragPct}
                onChange={(e) => setMinFragPct(e.target.value)}
                placeholder="e.g. 10"
                className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 font-mono"
              />
            </label>
            <button
              type="button"
              data-testid="index-mgmt-select-filtered"
              disabled={filteredKeys.length === 0}
              onClick={() => {
                if (allFilteredSelected) setSelected(new Set());
                else setSelected(new Set(filteredKeys));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {allFilteredSelected ? (
                <CheckSquare className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {allFilteredSelected ? 'Clear selection' : 'Select filtered'}
            </button>
            <button
              type="button"
              data-testid="index-mgmt-defrag-selected"
              disabled={selected.size === 0 || runningDefrag}
              onClick={() => setConfirmDefrag('selected')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25 disabled:opacity-50"
            >
              <Wrench className="w-3.5 h-3.5" />
              Defragment selected ({selected.size})
            </button>
            <button
              type="button"
              data-testid="index-mgmt-defrag-filtered"
              disabled={filteredKeys.length === 0 || runningDefrag}
              onClick={() => setConfirmDefrag('filtered')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Wrench className="w-3.5 h-3.5" />
              Defragment filtered ({filteredKeys.length})
            </button>
          </div>

          {(error || status) && (
            <p
              className={`text-[11px] ${error ? 'text-rose-300' : 'text-slate-400'}`}
              data-testid="index-mgmt-status"
            >
              {error || status}
              {safeMode && confirmDefrag
                ? ' Safe mode is on — confirm carefully before running rebuild/reorg.'
                : ''}
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
          {grouped.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500">
              {connectionId
                ? 'No indexes to show. Indexes and fragmentation load automatically when you pick a credential (or click Load indexes).'
                : 'Select a credential to begin.'}
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="index-mgmt-groups">
              {grouped.map(([tableName, rows]) => {
                const openGroup = expanded.has(tableName);
                return (
                  <li
                    key={tableName}
                    className="rounded-lg border border-slate-800 bg-slate-950/40 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(tableName)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-900/60"
                    >
                      {openGroup ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className="font-mono text-sm font-semibold text-slate-100 truncate">
                        {tableName}
                      </span>
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {rows.length} index{rows.length === 1 ? '' : 'es'}
                      </span>
                    </button>
                    {openGroup && (
                      <ul className="border-t border-slate-800 divide-y divide-slate-800/80">
                        {rows.map((row) => {
                          const severity = fragmentationSeverity(
                            row.frag?.fragmentationPercent
                          );
                          return (
                            <li
                              key={row.key}
                              className="flex items-center gap-2 px-3 py-2 text-[12px]"
                              data-testid={`index-mgmt-row-${row.key}`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleSelected(row.key)}
                                className="text-slate-400 hover:text-slate-100 shrink-0"
                                aria-label={`Select ${row.index.name}`}
                              >
                                {selected.has(row.key) ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-amber-300" />
                                ) : (
                                  <Square className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="font-mono font-semibold text-slate-200 truncate">
                                  {row.index.name}
                                  <span className="ml-1.5 text-[10px] font-bold uppercase text-sky-300/80">
                                    {row.index.unique ? 'unique' : 'duplicates ok'}
                                  </span>
                                </div>
                                <div className="font-mono text-slate-500 truncate">
                                  ({row.index.columns.join(', ')})
                                </div>
                                {row.tableError ? (
                                  <div className="text-[10px] text-rose-300/90 mt-0.5">
                                    {row.tableError}
                                  </div>
                                ) : null}
                              </div>
                              <div
                                className={`w-14 shrink-0 text-right font-bold tabular-nums ${fragClass(severity)}`}
                                title={row.frag ? 'Fragmentation percent' : 'Fetch fragmentation'}
                              >
                                {formatPct(row.frag?.fragmentationPercent)}
                              </div>
                              <button
                                type="button"
                                disabled={!row.defragSql.length || runningDefrag}
                                title={row.defragSql.join('\n') || 'No defrag SQL'}
                                onClick={() => void runDefrag([row.key])}
                                className="inline-flex items-center gap-1 shrink-0 rounded border border-slate-600 px-2 py-1 text-[11px] font-bold text-slate-200 hover:border-amber-400/50 hover:text-amber-100 disabled:opacity-40"
                              >
                                <Wrench className="w-3 h-3" />
                                Defragment
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {confirmDefrag &&
          createPortal(
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
              onClick={() => setConfirmDefrag(null)}
            >
              <div
                className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                data-testid="index-mgmt-confirm-defrag"
              >
                <h3 className="text-sm font-bold text-slate-100 mb-2">Confirm defragment</h3>
                <p className="text-xs text-slate-400 mb-4">
                  Run rebuild / reorganize / optimize statements for{' '}
                  <span className="text-slate-200 font-semibold">
                    {confirmDefrag === 'selected' ? selected.size : filteredKeys.length}
                  </span>{' '}
                  index(es) on{' '}
                  <span className="font-mono text-amber-200">{conn?.name || 'credential'}</span>?
                  This may lock tables briefly.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                    onClick={() => setConfirmDefrag(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="index-mgmt-confirm-defrag-run"
                    disabled={runningDefrag}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-rose-500/50 bg-rose-500/20 text-rose-50"
                    onClick={() =>
                      void runDefrag(
                        confirmDefrag === 'selected' ? [...selected] : filteredKeys
                      )
                    }
                  >
                    {runningDefrag ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wrench className="w-3.5 h-3.5" />
                    )}
                    Run defragment
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>,
    document.body
  );
};
