import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound } from 'lucide-react';
import { useSyncStore } from '@/app/store/useSyncStore';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { effectiveConnectionIds } from '@/app/store/sqlEditorTabLogic';
import { SQL_ICON_STROKE } from '@/shared/lib/iconStyle';

/**
 * Destination-server checklist. When "Same servers for all queries" is on,
 * checks update the shared list; otherwise each tab keeps its own selection.
 */
export const ConnectionChecklist: React.FC<{ variant?: 'list' | 'chips' }> = ({
  variant = 'list',
}) => {
  const connections = useSyncStore((s) => s.connections);
  const connectionsLoaded = useSyncStore((s) => s.connectionsLoaded);
  const tabs = useSqlEditorStore((s) => s.tabs);
  const activeTabId = useSqlEditorStore((s) => s.activeTabId);
  const shareDestinations = useSqlEditorStore((s) => s.shareDestinations);
  const sharedConnectionIds = useSqlEditorStore((s) => s.sharedConnectionIds);
  const setShareDestinations = useSqlEditorStore((s) => s.setShareDestinations);
  const toggleConnection = useSqlEditorStore((s) => s.toggleConnection);
  const pendingPassword = useSqlEditorStore((s) => s.pendingPassword);
  const submitSessionPassword = useSqlEditorStore((s) => s.submitSessionPassword);
  const cancelPasswordPrompt = useSqlEditorStore((s) => s.cancelPasswordPrompt);

  const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
  const selectedConnectionIds = effectiveConnectionIds(
    tab,
    shareDestinations,
    sharedConnectionIds
  ).filter((id) => connections.some((c) => c.id === id));

  const [pendingValue, setPendingValue] = useState('');

  const confirmPending = () => {
    submitSessionPassword(pendingValue);
    setPendingValue('');
  };

  const pendingModal = pendingPassword ? (
        createPortal(
          <div
            data-testid="sql-session-password"
            className="modal-overlay"
            onClick={() => {
              cancelPasswordPrompt();
              setPendingValue('');
            }}
          >
            <div
              className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5 flex flex-col gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" strokeWidth={SQL_ICON_STROKE} /> Password for “{pendingPassword.name}”
              </h3>
              <p className="text-xs text-slate-400">
                This connection was saved without a password. Enter it for this session only — it is
                never stored.
                {pendingPassword.resumeExecute ? ' Run will continue after you confirm.' : ''}
              </p>
              <input
                type="password"
                data-testid="sql-session-password-input"
                autoFocus
                value={pendingValue}
                onChange={(e) => setPendingValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmPending()}
                className="bg-slate-950 border border-slate-800 accent-focus rounded-md px-3 py-2 text-xs outline-none"
                placeholder="••••••••"
              />
              <div className="flex justify-end gap-2">
                <button
                  data-testid="sql-session-password-cancel"
                  onClick={() => {
                    cancelPasswordPrompt();
                    setPendingValue('');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  data-testid="sql-session-password-submit"
                  onClick={confirmPending}
                  className="px-3 py-1.5 text-xs font-bold accent-grad on-accent-fg rounded-md transition"
                >
                  Use for session
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      ) : null;

  if (variant === 'chips') {
    return (
      <div className="flex min-w-0 items-center gap-1" data-testid="sql-destination-chips">
        <button
          type="button"
          data-testid="sql-share-destinations-chip"
          title={
            shareDestinations
              ? 'All tabs share this checklist'
              : 'Each query tab has its own destinations'
          }
          onClick={() => setShareDestinations(!shareDestinations)}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            shareDestinations
              ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-200'
              : 'border-slate-700 text-slate-500 hover:text-slate-300'
          }`}
        >
          Shared
        </button>
        {!connectionsLoaded ? (
          <span className="text-[11px] text-slate-500">Loading…</span>
        ) : connections.length === 0 ? (
          <span className="truncate text-[11px] text-slate-500">No saved connections</span>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {connections.map((c) => {
              const on = selectedConnectionIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`sql-dest-chip-${c.name || c.id}`}
                  title={[c.host, c.database, c.schema].filter(Boolean).join(' / ') || c.name}
                  onClick={() => toggleConnection(c.id)}
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    on
                      ? 'border-cyan-500/40 bg-cyan-950/50 text-cyan-100'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                  }`}
                >
                  <span className="font-mono text-[9px] uppercase text-slate-500">{c.dialect}</span>{' '}
                  {c.name || '(unnamed)'}
                </button>
              );
            })}
          </div>
        )}
        {pendingModal}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 min-h-0 flex-1 h-full">
      <label
        className="flex items-start gap-2 text-[12px] text-slate-400 cursor-pointer select-none shrink-0"
        title="When on, every query tab uses the same destination servers. When off, each query has its own checklist."
      >
        <input
          type="checkbox"
          data-testid="sql-share-destinations"
          checked={shareDestinations}
          onChange={(e) => setShareDestinations(e.target.checked)}
          className="w-3.5 h-3.5 accent-cyan-600 cursor-pointer shrink-0 mt-0.5"
        />
        <span>
          <span className="font-bold text-slate-200">Same servers for all queries</span>
          <span className="block text-slate-500 leading-snug font-medium">
            {shareDestinations
              ? 'All tabs share this checklist'
              : 'Each query tab has its own destinations'}
          </span>
        </span>
      </label>

      {!connectionsLoaded ? (
        <p className="text-[13px] font-medium text-slate-500">Loading connections…</p>
      ) : connections.length === 0 ? (
        <p className="text-[13px] font-medium text-slate-500">
          No saved connections yet — add one via the Credentials button in the toolbar.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pr-0.5">
          {connections.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 text-[13px] font-semibold text-slate-300 cursor-pointer select-none hover:text-slate-100 hover:bg-slate-800/60 rounded px-0.5 py-0.5 shrink-0"
            >
              <input
                type="checkbox"
                data-testid={`sql-conn-check-${c.name || c.id}`}
                checked={selectedConnectionIds.includes(c.id)}
                onChange={() => toggleConnection(c.id)}
                className="w-3.5 h-3.5 accent-cyan-600 cursor-pointer shrink-0"
              />
              <span className="font-mono text-[11px] font-bold text-slate-500 uppercase shrink-0">
                [{c.dialect}]
              </span>
              <span
                className="truncate"
                title={[c.host, c.database, c.schema].filter(Boolean).join(' / ')}
              >
                {c.name || '(unnamed)'}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
