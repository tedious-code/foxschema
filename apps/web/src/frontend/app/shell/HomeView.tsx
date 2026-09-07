/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Home: recents and saved connections from Zustand only — no schema introspect.
 */
import React from 'react';
import { Database, Terminal } from 'lucide-react';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { useSyncStore } from '@/app/store/useSyncStore';
import { useUiStore } from '@/app/store/uiStore';
import { formatRelativeDay } from '@/features/sql-editor/lib/relativeTime';

function previewSql(sql: string): string {
  const line = sql.trim().split('\n')[0] ?? '';
  return line.length > 88 ? `${line.slice(0, 87)}…` : line;
}

export const HomeView: React.FC = () => {
  const recentQueries = useSqlEditorStore((s) => s.recentQueries);
  const openRecentQuery = useSqlEditorStore((s) => s.openRecentQuery);
  const connections = useSyncStore((s) => s.connections);
  const ensureConnectionSelected = useSqlEditorStore((s) => s.ensureConnectionSelected);
  const setActiveView = useUiStore((s) => s.setActiveView);

  const openRecent = (id: string) => {
    openRecentQuery(id);
    setActiveView('sqlEditor');
  };

  const openConnection = (id: string) => {
    ensureConnectionSelected(id);
    setActiveView('sqlEditor');
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6" data-testid="home-view">
      <h1 className="text-lg font-bold text-slate-100">Home</h1>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Recents and connections already on this device. Opening one does not introspect a database.
      </p>

      <section className="mt-6" data-testid="home-recents">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
          Recent queries
        </h2>
        {recentQueries.length === 0 ? (
          <p className="text-[12px] text-slate-500" data-testid="home-recents-empty">
            Run a query in the SQL Editor to see it here.
          </p>
        ) : (
          <ul className="space-y-1">
            {recentQueries.slice(0, 12).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  data-testid={`home-recent-${r.id}`}
                  onClick={() => openRecent(r.id)}
                  className="w-full text-left rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 hover:border-slate-600 hover:bg-slate-900"
                >
                  <span className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="text-[12px] font-semibold text-slate-100 truncate">
                      {r.title?.trim() || 'Query'}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-500 shrink-0">
                      {formatRelativeDay(r.ranAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-slate-400 truncate">
                    {previewSql(r.sql)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" data-testid="home-connections">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
          Connections
        </h2>
        {connections.length === 0 ? (
          <p className="text-[12px] text-slate-500">Save a connection from Schema Sync to see it here.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {connections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid={`home-connection-${c.id}`}
                  onClick={() => openConnection(c.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/40 px-2.5 py-1.5 text-[12px] font-semibold text-slate-200 hover:border-slate-600"
                >
                  <Database className="w-3.5 h-3.5 text-slate-500" />
                  {c.name}
                  <span className="text-[10px] uppercase text-slate-500">{c.dialect}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
