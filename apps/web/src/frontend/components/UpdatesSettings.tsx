import React, { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, ArrowUpCircle, Loader2 } from 'lucide-react';
import { checkForUpdates, type UpdateInfo } from '../api/updatesApi';

/** Current version + a "check for updates" control, in Settings. */
export const UpdatesSettings: React.FC = () => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const run = async () => {
    setChecking(true);
    try {
      setInfo(await checkForUpdates());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-xs flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-slate-300">
          Current version <span className="font-mono text-slate-200">v{info?.current ?? '—'}</span>
        </p>
        {info?.updateAvailable ? (
          <a
            href={info.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-amber-300 hover:underline"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" /> v{info.latest} available
          </a>
        ) : info ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {info.configured ? 'Up to date' : 'Up to date (no update feed configured)'}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={run}
        disabled={checking}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition disabled:opacity-50"
      >
        {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Check
      </button>
    </div>
  );
};
