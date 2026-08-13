import React, { Suspense, lazy, useEffect } from 'react';
import { TopToolbar } from './components/TopToolbar';
import { SchemaTreePanel } from './components/SchemaTreePanel';
import { ObjectDetailPanel } from './components/ObjectDetailPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';
import { AuthPage } from './components/AuthPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import { useSyncStore } from './store/useSyncStore';
import { useAuthStore } from './store/authStore';
import { useUiStore } from './store/uiStore';
import { apiGetPreferences } from './api/authApi';
import { ToastHost } from './components/ToastHost';
import { AlertCircle, AlertTriangle, Loader2, X } from 'lucide-react';

const SqlEditorView = lazy(() =>
  import('./components/sql-editor/SqlEditorView').then((m) => ({ default: m.SqlEditorView }))
);
const LokeeWeaveView = lazy(() =>
  import('./components/lokee-weave/LokeeWeaveView').then((m) => ({ default: m.LokeeWeaveView }))
);

const Workspace: React.FC = () => {
  const { errorMsg, warnings, dismissWarnings } = useSyncStore();
  const activeView = useUiStore((s) => s.activeView);
  const syncPane = useUiStore((s) => s.syncPane);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const canEditorAccess = useAuthStore((s) => s.can('editor.access'));
  const canSchemaBrowse = useAuthStore((s) => s.can('schema.browse'));
  const canSchemaCompare = useAuthStore((s) => s.can('schema.compare'));

  useEffect(() => {
    if (activeView === 'sqlEditor' && !canEditorAccess) {
      setActiveView('sync');
    }
    if (
      activeView === 'sync' &&
      !canSchemaBrowse &&
      !canSchemaCompare &&
      canEditorAccess
    ) {
      setActiveView('sqlEditor');
    }
  }, [
    activeView,
    canEditorAccess,
    canSchemaBrowse,
    canSchemaCompare,
    setActiveView,
  ]);

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 antialiased overflow-hidden">
      <TopToolbar />

      {errorMsg && (
        <div data-testid="error-banner" className="bg-rose-950/60 border-y border-rose-500/20 px-6 py-2.5 flex items-center gap-2.5 text-xs text-rose-300 font-semibold animate-slide-down">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div data-testid="warning-banner" className="bg-amber-950/50 border-y border-amber-500/20 px-6 py-2.5 flex items-start gap-2.5 text-xs text-amber-300 font-medium animate-slide-down">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5 flex-1">
            {warnings.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <button
            data-testid="dismiss-warnings-btn"
            onClick={dismissWarnings}
            className="shrink-0 p-0.5 text-amber-500 hover:text-amber-200 hover:bg-amber-500/15 rounded transition"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <main className="flex-1 flex min-h-0 overflow-hidden">
        {activeView === 'sqlEditor' ? (
          <ErrorBoundary>
            <Suspense fallback={<LoadingScreen />}>
              <SqlEditorView />
            </Suspense>
          </ErrorBoundary>
        ) : syncPane === 'history' && canSchemaBrowse ? (
          <ErrorBoundary>
            <Suspense fallback={<LoadingScreen />}>
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <LokeeWeaveView embedded />
              </div>
            </Suspense>
          </ErrorBoundary>
        ) : (
          <>
            <ErrorBoundary>
              <SchemaTreePanel />
            </ErrorBoundary>
            <ErrorBoundary>
              <ObjectDetailPanel />
            </ErrorBoundary>
          </>
        )}
      </main>
      <ToastHost />
    </div>
  );
};

const App: React.FC = () => {
  const { status, init } = useAuthStore();
  const { apply, hydrateFromServer } = useUiStore();

  useEffect(() => {
    apply(); // apply locally-saved appearance immediately
    init();
  }, [init, apply]);

  // Once signed in, load the user's saved connections and appearance.
  // Wait for sync-store persist rehydrate so selected connection IDs are
  // restored before loadConnections reapplies source/target configs.
  useEffect(() => {
    if (status !== 'ready') return;

    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      void useSyncStore.getState().loadConnections();
      apiGetPreferences()
        .then((p) => {
          if (!cancelled) hydrateFromServer(p.theme);
        })
        .catch(() => undefined);
    };

    if (useSyncStore.persist.hasHydrated()) {
      load();
      return () => {
        cancelled = true;
      };
    }

    const unsub = useSyncStore.persist.onFinishHydration(() => {
      load();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [status, hydrateFromServer]);

  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (status === 'anon') return <AuthPage />;
  if (status === 'onboarding') return <OnboardingWizard />;
  return <Workspace />;
};

export default App;
