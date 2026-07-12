import React, { useState } from 'react';
import { Loader2, AlertCircle, Mail } from 'lucide-react';
import { submitSignup, skipSignup } from '../api/signupApi';
import { Brand } from './Brand';

/**
 * One-time, skippable first-run prompt: "stay in the loop" email capture.
 * Shown after any required setup (desktop's silent key-binding step) resolves,
 * on both web and desktop. Submitting or skipping both dismiss it for good —
 * see signupApi.ts / backend modules/signup.module.ts.
 */
export const SignupWizard: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'submit' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('submit');
    setError(null);
    try {
      const result = await submitSignup(email.trim());
      if (result.ok) {
        onDone();
      } else {
        setError(result.error ?? 'Something went wrong. Try again, or skip for now.');
      }
    } catch {
      setError("Couldn't reach the server. Try again, or skip for now.");
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    setBusy('skip');
    try {
      await skipSignup();
    } catch {
      /* best-effort — don't trap the user behind a network hiccup */
    } finally {
      onDone();
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <Brand logoSize={48} textClassName="text-2xl font-bold" subtitle={false} />

        <form onSubmit={submit} className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 items-center text-center">
            <h1 className="text-base font-bold">Stay in the loop</h1>
            <p className="text-sm text-slate-400">
              Get notified about new dialects, releases, and features. No spam — unsubscribe anytime.
            </p>
          </div>

          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-md px-3 py-2.5 text-sm outline-none"
          />

          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy !== null}
            className="w-full accent-grad on-accent-fg font-semibold text-sm rounded-md px-4 py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy === 'submit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Notify me
          </button>

          <button
            type="button"
            onClick={skip}
            disabled={busy !== null}
            className="text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer disabled:opacity-50"
          >
            {busy === 'skip' ? 'Skipping…' : 'Skip for now'}
          </button>
        </form>
      </div>
    </div>
  );
};
