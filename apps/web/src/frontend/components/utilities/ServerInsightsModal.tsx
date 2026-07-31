/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Utilities → Server Insights: connection pool, user sessions, system info
 * (RAM / storage / CPU), and table/index sizes.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  Loader2,
  Network,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { dialectSupportsDbaUtility, formatBytes, type DbaUtilityKind } from '@foxschema/core';
import { fetchDbaUtility, type DbaUtilityResponse } from '../../api/schemaApi';
import { useSyncStore } from '../../store/useSyncStore';
import { useSqlEditorStore } from '../../store/useSqlEditorStore';
import { PROVIDER_SETTINGS } from '../../lib/provider-settings';

export type ServerInsightsTab = DbaUtilityKind;

interface Props {
  open: boolean;
  initialTab?: ServerInsightsTab;
  onClose: () => void;
}

const LS_CONN = 'foxschema-utilities-server-insights-connection';

const TABS: Array<{ id: ServerInsightsTab; label: string; icon: React.ReactNode }> = [
  { id: 'pool', label: 'Connection Pool', icon: <Network className="w-3.5 h-3.5" /> },
  { id: 'sessions', label: 'User Connections', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'system', label: 'System Info', icon: <Cpu className="w-3.5 h-3.5" /> },
  { id: 'sizes', label: 'Table & Index Size', icon: <HardDrive className="w-3.5 h-3.5" /> },
];

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-[15px] font-semibold text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;
}

/** Utilities modal: credential → tabbed DBA probes. */
export const ServerInsightsModal: React.FC<Props> = ({ open, initialTab = 'pool', onClose }) => {
  const connections = useSyncStore((s) => s.connections);
  const ensureConnectionSelected = useSqlEditorStore((s) => s.ensureConnectionSelected);
  const submitSessionPassword = useSqlEditorStore((s) => s.submitSessionPassword);
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);

  const [connectionId, setConnectionId] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [tab, setTab] = useState<ServerInsightsTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DbaUtilityResponse | null>(null);
  const [sizeFilter, setSizeFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    const saved = localStorage.getItem(LS_CONN) || '';
    const fallback = connections[0]?.id || '';
    const next = connections.some((c) => c.id === saved) ? saved : fallback;
    setConnectionId(next);
    setTab(initialTab);
    setError(null);
    setData(null);
    setPasswordDraft('');
    setSizeFilter('');
  }, [open, connections, initialTab]);

  const conn = connections.find((c) => c.id === connectionId) || null;
  const needsPassword = Boolean(conn && !conn.hasPassword && !sessionPasswords[connectionId]);
  const support = useMemo(
    () => dialectSupportsDbaUtility(conn?.dialect || '', tab),
    [conn?.dialect, tab]
  );

  const load = useCallback(async () => {
    if (!connectionId || !conn) {
      setError('Select a connection.');
      return;
    }
    if (needsPassword) {
      setError('Unlock the connection password first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await ensureConnectionSelected(connectionId);
      localStorage.setItem(LS_CONN, connectionId);
      const password = sessionPasswords[connectionId];
      const result = await fetchDbaUtility(
        { connectionId, password },
        { kind: tab, schema: conn.schema }
      );
      setData(result);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load utility data');
    } finally {
      setLoading(false);
    }
  }, [
    connectionId,
    conn,
    needsPassword,
    ensureConnectionSelected,
    sessionPasswords,
    tab,
  ]);

  useEffect(() => {
    if (!open || !connectionId || needsPassword || !support.query) return;
    void load();
  }, [open, connectionId, tab, needsPassword, support.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = () => {
    if (!connectionId || !passwordDraft.trim()) return;
    // ensureConnectionSelected sets pendingPassword; submit stores it.
    ensureConnectionSelected(connectionId);
    submitSessionPassword(passwordDraft.trim());
    setPasswordDraft('');
    setError(null);
  };

  const filteredSizes = useMemo(() => {
    const rows = data?.sizes ?? [];
    const q = sizeFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.schemaName, r.objectName, r.tableName, r.objectType]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [data?.sizes, sizeFilter]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
      data-testid="server-insights-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0f172a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 text-slate-100">
            <Activity className="h-4 w-4 text-sky-400" />
            <h2 className="text-[15px] font-semibold">Server Insights</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-b border-white/10 px-4 py-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] text-slate-400">
            Connection
            <select
              data-testid="server-insights-connection"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className="rounded-md border border-white/15 bg-slate-900 px-2.5 py-2 text-[13px] text-slate-100"
            >
              {connections.length === 0 ? (
                <option value="">No connections</option>
              ) : (
                connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({PROVIDER_SETTINGS[c.dialect]?.label || c.dialect})
                  </option>
                ))
              )}
            </select>
          </label>
          {needsPassword && (
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-slate-400">
                Password
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(e) => setPasswordDraft(e.target.value)}
                  className="rounded-md border border-white/15 bg-slate-900 px-2.5 py-2 text-[13px] text-slate-100"
                  placeholder="Unlock connection"
                />
              </label>
              <button
                type="button"
                onClick={() => unlock()}
                className="rounded-md bg-sky-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-sky-500"
              >
                Unlock
              </button>
            </div>
          )}
          <button
            type="button"
            data-testid="server-insights-refresh"
            disabled={loading || !connectionId || needsPassword || !support.query}
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-[13px] font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 pt-2">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`server-insights-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[12px] font-semibold ${
                  active
                    ? 'bg-white/10 text-sky-300 border border-b-0 border-white/15'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <p className="mb-3 text-[12px] text-slate-400">{support.hint}</p>
          {error && (
            <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">
              {error}
            </div>
          )}
          {!support.query && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-100">
              This dialect does not expose a built-in probe for this view.
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-[13px] text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {!loading && data?.kind === 'pool' && data.pool && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <MetricCard label="Max" value={data.pool.maxConnections?.toLocaleString() ?? '—'} />
                <MetricCard label="Current" value={data.pool.currentConnections?.toLocaleString() ?? '—'} />
                <MetricCard label="Active" value={data.pool.activeConnections?.toLocaleString() ?? '—'} />
                <MetricCard label="Available" value={data.pool.availableConnections?.toLocaleString() ?? '—'} />
                <MetricCard label="Waiting" value={data.pool.waitCount?.toLocaleString() ?? '—'} />
              </div>
              {data.pool.details.length > 0 && (
                <div className="rounded-lg border border-white/10 overflow-hidden">
                  <table className="w-full text-left text-[12px]">
                    <tbody>
                      {data.pool.details.map((d) => (
                        <tr key={d.key} className="border-t border-white/5">
                          <td className="px-3 py-1.5 text-slate-400">{d.key}</td>
                          <td className="px-3 py-1.5 text-slate-100 font-mono">{d.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!loading && data?.kind === 'sessions' && (
            <div className="overflow-auto rounded-lg border border-white/10">
              <table className="min-w-full text-left text-[12px]">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Session</th>
                    <th className="px-3 py-2 font-semibold">User</th>
                    <th className="px-3 py-2 font-semibold">Host</th>
                    <th className="px-3 py-2 font-semibold">DB</th>
                    <th className="px-3 py-2 font-semibold">State</th>
                    <th className="px-3 py-2 font-semibold">Query</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.sessions ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        No sessions returned.
                      </td>
                    </tr>
                  ) : (
                    (data.sessions ?? []).map((s) => (
                      <tr key={s.sessionId} className="border-t border-white/5 align-top">
                        <td className="px-3 py-1.5 font-mono text-slate-200">{s.sessionId}</td>
                        <td className="px-3 py-1.5 text-slate-200">{s.userName || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-400">{s.clientHost || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-400">{s.databaseName || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{s.state || '—'}</td>
                        <td className="max-w-[280px] truncate px-3 py-1.5 font-mono text-slate-400" title={s.queryText || ''}>
                          {s.queryText || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && data?.kind === 'system' && data.system && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetricCard label="CPU cores" value={data.system.cpuCount?.toLocaleString() ?? '—'} />
                <MetricCard label="CPU usage" value={formatPct(data.system.cpuUsagePercent)} />
                <MetricCard label="RAM total" value={formatBytes(data.system.memoryTotalBytes)} />
                <MetricCard label="RAM used" value={formatBytes(data.system.memoryUsedBytes)} />
                <MetricCard label="RAM available" value={formatBytes(data.system.memoryAvailableBytes)} />
                <MetricCard label="DB storage used" value={formatBytes(data.system.storageUsedBytes)} />
                <MetricCard label="Uptime" value={formatUptime(data.system.uptimeSeconds)} />
                <MetricCard
                  label="Version"
                  value={
                    data.system.serverVersion
                      ? data.system.serverVersion.length > 28
                        ? `${data.system.serverVersion.slice(0, 28)}…`
                        : data.system.serverVersion
                      : '—'
                  }
                />
              </div>
              {data.system.serverVersion && (
                <p className="text-[12px] text-slate-400 break-all">{data.system.serverVersion}</p>
              )}
            </div>
          )}

          {!loading && data?.kind === 'sizes' && (
            <div className="space-y-3">
              <input
                data-testid="server-insights-size-filter"
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
                placeholder="Filter tables / indexes…"
                className="w-full rounded-md border border-white/15 bg-slate-900 px-3 py-2 text-[13px] text-slate-100"
              />
              <div className="overflow-auto rounded-lg border border-white/10">
                <table className="min-w-full text-left text-[12px]">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Object</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold">Table</th>
                      <th className="px-3 py-2 font-semibold text-right">Total</th>
                      <th className="px-3 py-2 font-semibold text-right">Data</th>
                      <th className="px-3 py-2 font-semibold text-right">Index</th>
                      <th className="px-3 py-2 font-semibold text-right">Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSizes.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                          No size rows returned.
                        </td>
                      </tr>
                    ) : (
                      filteredSizes.map((r, i) => (
                        <tr key={`${r.schemaName}-${r.objectName}-${i}`} className="border-t border-white/5">
                          <td className="px-3 py-1.5 text-slate-100">
                            {r.schemaName ? `${r.schemaName}.` : ''}
                            {r.objectName}
                          </td>
                          <td className="px-3 py-1.5 text-slate-400">{r.objectType}</td>
                          <td className="px-3 py-1.5 text-slate-400">{r.tableName || '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-200">
                            {formatBytes(r.totalBytes)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                            {formatBytes(r.dataBytes)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                            {formatBytes(r.indexBytes)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                            {r.rowCount?.toLocaleString() ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && !error && support.query && !data && (
            <div className="flex items-center gap-2 text-[13px] text-slate-500">
              <Database className="h-4 w-4" /> Select a connection and refresh.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
