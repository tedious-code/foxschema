import React from 'react';
import { PlugZap, RefreshCw } from 'lucide-react';
import { useBackendHealth } from '@/app/shell/useBackendHealth';

/**
 * Shown when the API process is unreachable.
 *
 * The UI and the API are separate processes, so the API can die while the page
 * keeps rendering its last state. Every action then fails with its own
 * unrelated-looking message and the app reads as randomly broken. This says
 * the real cause once, and tells the reader the one thing that fixes it.
 */
export const BackendOfflineBanner: React.FC = () => {
  const { status, checkNow } = useBackendHealth();
  if (status !== 'offline') return null;

  return (
    <div
      data-testid="backend-offline-banner"
      role="alert"
      className="bg-rose-950/80 border-y border-rose-500/40 px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3 text-xs text-rose-200 font-medium animate-slide-down"
    >
      {/* The retry button is a fixed width; beside the text on a narrow pane it
          squeezes the message into a one-word-per-line column, so it drops
          below instead. */}
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <PlugZap className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5 min-w-0">
        <span className="font-bold text-rose-100">Can’t reach the Fox Schema backend</span>
        <span className="text-rose-300/90">
          The API server stopped responding, so nothing will save until it is back. Stop Fox Schema
          and start it again — your saved connections and history are untouched. Retrying
          automatically.
        </span>
        </div>
      </div>
      <button
        type="button"
        data-testid="backend-offline-retry"
        onClick={checkNow}
        className="shrink-0 self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25 font-bold"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry now
      </button>
    </div>
  );
};
