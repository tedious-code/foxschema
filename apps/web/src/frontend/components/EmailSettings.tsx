import React, { useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2, Pencil } from 'lucide-react';
import { isTauri } from '../api/apiBase';
import { updateEmail, type AppInfo } from '../api/setupApi';

/**
 * Rebind the encryption key's email in Settings → Security. Setup itself
 * defaults to a placeholder email so first-run needs no input — this is
 * where a user sets (or changes) the real one whenever they want.
 * Desktop-only; the web edition's key isn't email-bound the same way.
 */
export const EmailSettings: React.FC<{ info: AppInfo; onUpdated: (info: AppInfo) => void }> = ({ info, onUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(info.security.boundEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!isTauri() || !info.security.emailBound) {
    return (
      <p className="text-slate-300">
        {info.security.emailBound ? (
          <>
            Encryption key bound to <span className="font-mono text-slate-200">{info.security.boundEmail}</span> and
            held in the OS keychain — a copied database can't be decrypted elsewhere.
          </>
        ) : (
          <>Encryption key stored on this install (legacy key scheme).</>
        )}
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const state = await updateEmail(email.trim());
      onUpdated({ ...info, security: { ...info.security, boundEmail: state.email } });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update email.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
        <p className="text-slate-300 flex-1">
          Encryption key bound to <span className="font-mono text-slate-200">{info.security.boundEmail}</span> and
          held in the OS keychain — a copied database can't be decrypted elsewhere.
        </p>
        <button
          type="button"
          onClick={() => {
            setEmail(info.security.boundEmail);
            setEditing(true);
            setSaved(false);
          }}
          className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
        >
          <Pencil className="w-3 h-3" /> Change
        </button>
        {saved && (
          <span className="shrink-0 flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> Saved
          </span>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-2.5 py-1.5 text-xs outline-none"
        />
        <button
          type="submit"
          disabled={saving}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold accent-grad on-accent-fg rounded-md transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="shrink-0 px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
};
