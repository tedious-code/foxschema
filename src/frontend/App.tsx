import React from 'react';
import { TopToolbar } from './components/TopToolbar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useSyncStore } from './store/useSyncStore';
import { AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const { errorMsg } = useSyncStore();

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 antialiased overflow-hidden">
      {/* Top Banner / Navigation */}
      <TopToolbar />

      {/* Error notification header */}
      {errorMsg && (
        <div className="bg-rose-950/60 border-y border-rose-500/20 px-6 py-2.5 flex items-center gap-2.5 text-xs text-rose-300 font-semibold animate-slide-down">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Workspace Split View */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Schema Tree Browser */}
        <ErrorBoundary>
          <LeftPanel />
        </ErrorBoundary>

        {/* Selected Schema DDL & Operation Map */}
        <ErrorBoundary>
          <RightPanel />
        </ErrorBoundary>
      </main>
    </div>
  );
};

export default App;
