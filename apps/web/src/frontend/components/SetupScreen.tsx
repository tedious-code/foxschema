import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { completeSetup, type SetupState } from '../api/setupApi';
import { Brand } from './Brand';

// Matches authStore.ts's LOCAL_USER — the same placeholder identity the web
// edition's single-user mode already uses. Real per-install key binding (a
// distinct email per machine) is opt-in via Settings → Security → Change,
// rather than required to get through first run.
const DEFAULT_EMAIL = 'local@foxschema.app';

/**
 * One-time desktop first-run screen. Silently binds the encryption key (kept
 * in the OS keychain) and starts the app on the default SQLite location — no
 * input required. Both the bound email and the database engine/location can
 * be changed afterward in Settings → Security / Settings → Database.
 */
export const SetupScreen: React.FC<{ initial: SetupState; onDone: (s: SetupState) => void }> = ({
  initial,
  onDone,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // StrictMode double-invokes effects in dev (mount → cleanup → remount) to
  // surface missing-cleanup bugs. The `alive` flag below only guards against
  // a stray setState after unmount — it doesn't stop completeSetup() itself
  // from actually firing twice, which raced two sidecar subprocesses against
  // the same SQLite file ("database is locked"). A ref survives that
  // mount/unmount cycle, so gating on "have we already fired *this* attempt"
  // makes the real IPC call fire exactly once per attempt, StrictMode or not.
  const firedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (firedAttempt.current === attempt) return;
    firedAttempt.current = attempt;

    let alive = true;
    setError(null);
    completeSetup({
      email: initial.email || DEFAULT_EMAIL,
      engine: 'sqlite',
    })
      .then((state) => alive && onDone(state))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Setup failed.'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retried by bumping `attempt`, not by re-deriving inputs
  }, [attempt]);

  return (
    <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <Brand logoSize={48} textClassName="text-2xl font-bold" subtitle={false} />

        {error ? (
          <div className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-6 flex flex-col gap-4">
            <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="accent-grad on-accent-fg font-semibold text-sm rounded-md px-4 py-2.5 flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" /> Retry
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Securing this install…
          </p>
        )}
      </div>
    </div>
  );
};
