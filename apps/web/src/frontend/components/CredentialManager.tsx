import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Pencil, KeyRound, Database, Server, User, Calendar, Search, ArrowDownUp } from 'lucide-react';
import { useSyncStore } from '../store/useSyncStore';
import { ConnectionModal } from './ConnectionModal';
import { PROVIDER_SETTINGS } from '../lib/provider-settings';
import type { SavedConnectionSummary } from '../api/authApi';
import type { Dialect } from '../lib/provider-settings';

interface Props {
  open: boolean;
  onClose: () => void;
}

const DIALECT_STYLES: Record<string, { badge: string; dot: string }> = {
  postgres:  { badge: 'bg-blue-950/60 text-blue-300 border-blue-700/50',   dot: 'bg-blue-400' },
  mysql:     { badge: 'bg-orange-950/60 text-orange-300 border-orange-700/50', dot: 'bg-orange-400' },
  mariadb:   { badge: 'bg-amber-950/60 text-amber-300 border-amber-700/50',  dot: 'bg-amber-400' },
  db2:       { badge: 'bg-cyan-950/60 text-cyan-300 border-cyan-700/50',    dot: 'bg-cyan-400' },
  sqlserver: { badge: 'bg-sky-950/60 text-sky-300 border-sky-700/50',       dot: 'bg-sky-400' },
  oracle:    { badge: 'bg-rose-950/60 text-rose-300 border-rose-700/50',    dot: 'bg-rose-400' },
  sqlite:    { badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50', dot: 'bg-emerald-400' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function dialectLabel(dialect: string): string {
  return PROVIDER_SETTINGS[dialect.toLowerCase()]?.label ?? dialect.toUpperCase();
}

/** Manage reusable, encrypted credentials. They appear in the source/target dropdowns. */
export const CredentialManager: React.FC<Props> = ({ open, onClose }) => {
  const { connections, addConnection, updateConnection, removeConnection } = useSyncStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SavedConnectionSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dialectFilter, setDialectFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'provider'>('recent');

  // Distinct providers actually present, so the filter never lists empty options.
  const availableDialects = useMemo(
    () => Array.from(new Set(connections.map((c) => c.dialect.toLowerCase()))).sort(),
    [connections]
  );

  // Keep hooks above the early return (rules-of-hooks).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = connections.filter((c) => {
      if (dialectFilter !== 'all' && c.dialect.toLowerCase() !== dialectFilter) return false;
      if (!q) return true;
      return [c.name, c.host, c.database, c.username, dialectLabel(c.dialect)]
        .some((f) => f?.toLowerCase().includes(q));
    });
    const byRecent = (a: SavedConnectionSummary, b: SavedConnectionSummary) => (b.createdAt || '').localeCompare(a.createdAt || '');
    const byName = (a: SavedConnectionSummary, b: SavedConnectionSummary) => (a.name || '').localeCompare(b.name || '');
    const byProvider = (a: SavedConnectionSummary, b: SavedConnectionSummary) =>
      dialectLabel(a.dialect).localeCompare(dialectLabel(b.dialect)) || byName(a, b);
    const cmp = sortBy === 'name' ? byName : sortBy === 'provider' ? byProvider : byRecent;
    return [...filtered].sort(cmp);
  }, [connections, search, dialectFilter, sortBy]);

  if (!open) return null;

  return createPortal(
    <div data-testid="cred-manager" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-[620px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/50 border border-cyan-800/40 flex items-center justify-center shrink-0">
              <KeyRound className="w-4.5 h-4.5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-slate-100 font-bold text-base">Saved Credentials</h2>
              <p className="text-xs text-slate-400 mt-0.5">Encrypted at rest · reusable from the connection dropdowns</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 tabular-nums">
              {visible.length === connections.length ? `${connections.length} saved` : `${visible.length} of ${connections.length}`}
            </span>
            <button data-testid="cred-close-btn" onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition">
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Search / filter / sort toolbar */}
        {connections.length > 0 && (
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                data-testid="cred-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, host, database, user…"
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-600 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none"
              />
            </div>
            <select
              data-testid="cred-dialect-filter"
              value={dialectFilter}
              onChange={(e) => setDialectFilter(e.target.value)}
              title="Filter by provider"
              className="bg-slate-950 border border-slate-800 focus:border-cyan-600 rounded-lg px-2 py-1.5 text-xs text-slate-300 outline-none cursor-pointer"
            >
              <option value="all">All providers</option>
              {availableDialects.map((d) => (
                <option key={d} value={d}>{dialectLabel(d)}</option>
              ))}
            </select>
            <div className="relative">
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                data-testid="cred-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'recent' | 'name' | 'provider')}
                title="Sort"
                className="bg-slate-950 border border-slate-800 focus:border-cyan-600 rounded-lg pl-7 pr-2 py-1.5 text-xs text-slate-300 outline-none cursor-pointer"
              >
                <option value="recent">Recent</option>
                <option value="name">Name</option>
                <option value="provider">Provider</option>
              </select>
            </div>
          </div>
        )}

        {/* List */}
        <div
          className="p-4 space-y-2.5"
          style={{ maxHeight: '60vh', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}
        >
          {connections.length === 0 ? (
            <div className="text-center py-14 text-slate-500 text-sm">
              <div className="w-14 h-14 rounded-full bg-slate-800/60 flex items-center justify-center mx-auto mb-3">
                <Database className="w-6 h-6 text-slate-600" />
              </div>
              <p className="font-medium text-slate-400">No saved credentials yet</p>
              <p className="text-xs text-slate-600 mt-1">Add one to reuse connections across comparisons</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center mx-auto mb-3">
                <Search className="w-5 h-5 text-slate-600" />
              </div>
              <p className="font-medium text-slate-400">No credentials match your filters</p>
              <button
                onClick={() => { setSearch(''); setDialectFilter('all'); }}
                className="text-xs text-cyan-400 hover:text-cyan-300 mt-1.5 cursor-pointer"
              >
                Clear filters
              </button>
            </div>
          ) : (
            visible.map((c) => {
              const styles = DIALECT_STYLES[c.dialect.toLowerCase()] ?? { badge: 'bg-slate-800 text-slate-300 border-slate-700/50', dot: 'bg-slate-400' };
              const hostLine = [c.host, c.port ? `:${c.port}` : ''].join('').trim();
              const dbLine = [c.database, c.schema ? `· ${c.schema}` : ''].filter(Boolean).join('  ');
              return (
                <div
                  key={c.id}
                  className="rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition group"
                >
                  {/* Top row: dialect badge + name + actions */}
                  <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
                    <button
                      onClick={() => setEditing(c)}
                      title="Edit credential"
                      className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="mt-0.5 shrink-0">
                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md border ${styles.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
                          {dialectLabel(c.dialect)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100 truncate leading-tight">
                          {c.name || `${c.host ?? ''}/${c.database ?? ''}`}
                        </p>
                        {c.name && (c.host || c.database) && (
                          <p className="text-xs text-slate-500 font-mono truncate mt-0.5">
                            {hostLine}{dbLine ? ` / ${dbLine}` : ''}
                          </p>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      <button
                        onClick={() => setEditing(c)}
                        title="Edit"
                        className="p-2 text-slate-500 hover:text-cyan-300 hover:bg-cyan-950/30 rounded-lg transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          setDeletingId(c.id);
                          try { await removeConnection(c.id); } finally { setDeletingId(null); }
                        }}
                        disabled={deletingId === c.id}
                        title="Delete"
                        className="p-2 text-slate-500 hover:text-rose-300 hover:bg-rose-950/30 rounded-lg transition disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Detail row */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 pb-3.5 border-t border-slate-800/60 pt-3">
                    {(c.host || c.database) && (
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Server className="w-3 h-3 text-slate-600" />
                        <span className="font-mono">{hostLine || c.database}</span>
                      </span>
                    )}
                    {c.database && (
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Database className="w-3 h-3 text-slate-600" />
                        <span className="font-mono">{c.database}{c.schema ? ` / ${c.schema}` : ''}</span>
                      </span>
                    )}
                    {c.username && (
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <User className="w-3 h-3 text-slate-600" />
                        <span className="font-mono">{c.username}</span>
                      </span>
                    )}
                    {c.createdAt && (
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-600 ml-auto">
                        <Calendar className="w-3 h-3" />
                        {formatDate(c.createdAt)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 bg-slate-950/60 border-t border-slate-800">
          <button
            data-testid="cred-add-btn"
            onClick={() => setAdding(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold accent-grad on-accent-fg rounded-lg transition cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Credential
          </button>
        </div>
      </div>

      <ConnectionModal
        open={adding || !!editing}
        mode="credential"
        dialect={(editing?.dialect as Dialect) ?? 'db2'}
        initialName={editing?.name}
        initialHasPassword={editing?.hasPassword}
        initialOptions={
          editing
            ? { host: editing.host, port: editing.port, database: editing.database, username: editing.username, schema: editing.schema }
            : undefined
        }
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSaveCredential={async (input) => {
          if (editing) await updateConnection(editing.id, input);
          else await addConnection(input);
        }}
      />
    </div>,
    document.body
  );
};
