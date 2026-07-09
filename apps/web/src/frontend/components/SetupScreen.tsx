import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, ShieldCheck, Copy, Check, FolderOpen } from 'lucide-react';
import { completeSetup, getLogPath, revealLogFile, type SetupState } from '../api/setupApi';
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
  const [logPath, setLogPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Setup failed.');
        getLogPath().then((p) => alive && setLogPath(p)).catch(() => {});
      });
    return () => {
      alive = false;
    };
    // Depends only on `attempt` by design: retries re-fire it by bumping the
    // counter, not by re-deriving `initial`/`onDone`. (Plain comment, not an
    // eslint-disable — the react-hooks plugin isn't part of this repo's lint
    // setup, and ESLint errors on directives naming rules it doesn't know.)
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
            {logPath && (
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 bg-slate-950/60 border border-slate-800 rounded-md px-2.5 py-1.5">
                <span className="truncate font-mono" title={logPath}>{logPath}</span>
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => revealLogFile()}
                    title="Show log file in Finder"
                    className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(logPath).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                    title="Copy log file path"
                    className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
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
