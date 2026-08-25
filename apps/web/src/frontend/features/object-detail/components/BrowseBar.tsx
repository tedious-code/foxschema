/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browse's toolbar: one database, nothing else.
 *
 * Browse used to borrow Compare's bar — two connection cards, a swap arrow, a
 * direction label — for a pane that reads a single schema and has no direction
 * at all. Half those controls were meaningless here, and the "Browse" buttons
 * that started the read were buried on the Original/Target cards, which is why
 * nobody found them.
 *
 * Picking a connection loads it. That is the whole interaction.
 */
import React from 'react';
import { Loader2, Search } from 'lucide-react';
import { useSyncStore } from '@/app/store/useSyncStore';
import { getSessionPassword } from '@/shared/lib/sessionPasswords';

export function BrowseBar(): React.ReactElement {
  const connections = useSyncStore((s) => s.connections);
  const sourceConfig = useSyncStore((s) => s.sourceConfig);
  const isBrowsing = useSyncStore((s) => s.isBrowsing);
  const browseMode = useSyncStore((s) => s.browseMode);
  const selectedObjectTypes = useSyncStore((s) => s.selectedObjectTypes);
  const applySavedConnection = useSyncStore((s) => s.applySavedConnection);
  const browseSchema = useSyncStore((s) => s.browseSchema);

  const selectedId = sourceConfig.connectionId ?? '';

  /**
   * Browsing reads through the `source` side because that is where the store's
   * connection config lives; the user never sees a side here. A saved
   * connection with no stored password can still be browsed if this session
   * already unlocked it — same rule Compare uses.
   */
  const onPick = (id: string) => {
    if (!id) return;
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    const password = conn.hasPassword ? undefined : getSessionPassword(id);
    applySavedConnection('source', id, password);
    void browseSchema('source');
  };

  const label = sourceConfig.option.database
    ? `${sourceConfig.dialect.toUpperCase()} · ${[sourceConfig.option.host, sourceConfig.option.database]
        .filter(Boolean)
        .join('/')}${sourceConfig.schema ? `.${sourceConfig.schema}` : ''}`
    : null;

  return (
    <div
      data-testid="browse-bar"
      className="flex flex-wrap items-center gap-3 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2"
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-500/80">
        Database
      </span>
      <select
        data-testid="browse-connection-select"
        value={selectedId}
        disabled={connections.length === 0 || isBrowsing}
        onChange={(e) => onPick(e.target.value)}
        title="Read this database's objects"
        className="min-w-0 flex-1 max-w-md text-xs bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 truncate disabled:opacity-50"
      >
        <option value="">{connections.length === 0 ? 'No saved connections' : 'Pick a database…'}</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            [{c.dialect.toUpperCase()}] {c.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        data-testid="browse-reload-btn"
        disabled={!selectedId || isBrowsing || selectedObjectTypes.length === 0}
        onClick={() => void browseSchema('source')}
        title="Re-read this database"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-0.5 text-xs font-medium text-cyan-400 transition hover:border-cyan-400/60 hover:bg-cyan-950/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isBrowsing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Search className="w-3.5 h-3.5" />
        )}
        {isBrowsing ? 'Reading…' : browseMode ? 'Reload' : 'Browse'}
      </button>

      {label && <span className="truncate font-mono text-[11px] text-slate-500">{label}</span>}
    </div>
  );
}
