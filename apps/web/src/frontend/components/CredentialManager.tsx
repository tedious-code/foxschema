import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Pencil, KeyRound, Database } from 'lucide-react';
import { useSyncStore } from '../store/useSyncStore';
import { ConnectionModal } from './ConnectionModal';
import type { SavedConnectionSummary } from '../api/authApi';
import type { Dialect } from '../lib/provider-settings';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Manage reusable, encrypted credentials. They appear in the source/target dropdowns. */
export const CredentialManager: React.FC<Props> = ({ open, onClose }) => {
  const { connections, addConnection, updateConnection, removeConnection } = useSyncStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SavedConnectionSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-[560px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-slate-100 font-bold text-base">Saved Credentials</h2>
              <p className="text-xs text-slate-400 mt-0.5">Encrypted at rest · reusable from the connection dropdowns</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 max-h-[50vh] overflow-y-auto space-y-2">
          {connections.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">
              <Database className="w-8 h-8 mx-auto mb-2 text-slate-700" />
              No saved credentials yet.
            </div>
          ) : (
            connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-950/50 border border-slate-800 hover:border-slate-700 transition">
                <button
                  onClick={() => setEditing(c)}
                  title="Edit credential"
                  className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                >
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/50 shrink-0">
                    {c.dialect.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate">{c.name || `${c.host}/${c.database}`}</p>
                    <p className="text-xs text-slate-500 font-mono truncate">
                      {c.host}{c.database ? ` / ${c.database}` : ''}{c.schema ? ` · ${c.schema}` : ''}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(c)}
                    title="Edit credential"
                    className="p-2 text-slate-500 hover:text-cyan-300 hover:bg-cyan-950/20 rounded-md transition cursor-pointer"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      setDeletingId(c.id);
                      try { await removeConnection(c.id); } finally { setDeletingId(null); }
                    }}
                    disabled={deletingId === c.id}
                    title="Delete credential"
                    className="p-2 text-slate-500 hover:text-rose-300 hover:bg-rose-950/20 rounded-md transition disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 bg-slate-950/60 border-t border-slate-800">
          <button
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
