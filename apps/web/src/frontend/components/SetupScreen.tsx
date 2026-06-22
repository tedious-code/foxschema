import React, { useState } from 'react';
import { Database, Loader2, AlertCircle, ShieldCheck, HardDrive, FolderOpen } from 'lucide-react';
import { completeSetup, pickDbLocation, type SetupState } from '../api/setupApi';
import { isTauri } from '../api/apiBase';

/**
 * One-time desktop first-run screen. Collects the user's email — the per-install
 * encryption key is bound to it and stored in the OS keychain, so a copied
 * database can't be decrypted on another machine — and where the bundled SQLite
 * database lives. New installs always start on SQLite; switching to Postgres /
 * MySQL is done later in Settings → Database.
 */
export const SetupScreen: React.FC<{ initial: SetupState; onDone: (s: SetupState) => void }> = ({
  initial,
  onDone,
}) => {
  const [email, setEmail] = useState(initial.email);
  const [dbPath, setDbPath] = useState(initial.db_path || initial.default_db_path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = async () => {
    try {
      const picked = await pickDbLocation(dbPath || initial.default_db_path);
      if (picked) setDbPath(picked);
    } catch {
      /* dialog cancelled / unavailable — keep the typed value */
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const state = await completeSetup({
        email: email.trim(),
        engine: 'sqlite',
        dbPath: dbPath.trim() || undefined,
      });
      onDone(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-500 p-3 rounded-xl on-accent-fg shadow-lg shadow-cyan-500/10 mb-3">
            <Database className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold">Welcome to FoxSchema</h1>
          <p className="text-sm text-slate-400 mt-1 text-center">Let's secure this install. Takes a few seconds.</p>
        </div>

        <form onSubmit={submit} className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Your email
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-3 py-2 text-sm outline-none"
            />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Your encryption key is generated on this machine, bound to this email, and stored in the OS keychain —
              never written to disk. Copying the database to another computer won't decrypt it.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" /> Database location
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={dbPath}
                onChange={(e) => setDbPath(e.target.value)}
                spellCheck={false}
                className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-3 py-2 text-xs font-mono outline-none"
              />
              {isTauri() && (
                <button
                  type="button"
                  onClick={browse}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition"
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Browse
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              FoxSchema stores its data in a local SQLite database here. You can switch to your own Postgres or MySQL
              server later in Settings → Database.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="accent-grad on-accent-fg font-semibold text-sm rounded-md px-4 py-2.5 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {busy ? 'Securing…' : 'Finish setup'}
          </button>
        </form>
      </div>
    </div>
  );
};
