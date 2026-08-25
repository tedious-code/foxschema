import React, { Suspense, lazy, useEffect } from 'react';
import { TopToolbar } from '@/app/shell/TopToolbar';
import { SchemaTreePanel } from '@/features/sql-editor';
import { ObjectDetailPanel } from '@/features/object-detail';
import { ErrorBoundary } from '@/app/shell/ErrorBoundary';
import { LoadingScreen } from '@/app/shell/LoadingScreen';
import { AuthPage } from '@/features/auth';
import { OnboardingWizard } from '@/features/auth';
import { useSyncStore } from '@/app/store/useSyncStore';
import { useAuthStore } from '@/app/store/authStore';
import { useUiStore } from '@/app/store/uiStore';
import { apiGetPreferences } from '@/shared/api/authApi';
import { ToastHost } from '@/app/shell/ToastHost';
import { AlertCircle, AlertTriangle, Loader2, X } from 'lucide-react';
import { BackendOfflineBanner } from '@/app/shell/BackendOfflineBanner';

const AccessView = lazy(() =>
  import('@/features/access').then((m) => ({ default: m.AccessView }))
);
const SqlEditorView = lazy(() =>
  import('@/features/sql-editor').then((m) => ({ default: m.SqlEditorView }))
);
const LokeeWeaveView = lazy(() =>
  import('@/features/lokee-weave').then((m) => ({ default: m.LokeeWeaveView }))
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

      {/* Above every other banner: when the backend is gone, nothing else on
          screen is trustworthy and no other message explains why. */}
      <BackendOfflineBanner />

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
        {activeView === 'access' ? (
          <ErrorBoundary>
            <Suspense fallback={<LoadingScreen />}>
              <AccessView />
            </Suspense>
          </ErrorBoundary>
        ) : activeView === 'sqlEditor' ? (
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

  // The banner belongs here too, not only in Workspace: `init()` is what talks
  // to the API first, so a reload while the backend is down leaves `status` on
  // 'loading' forever. Without this the reader gets an eternal spinner and no
  // hint of why — the exact confusion the banner exists to end.
  if (status === 'loading') {
    return (
      <div className="h-screen flex flex-col bg-slate-950 text-slate-500">
        <BackendOfflineBanner />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      </div>
    );
  }
  if (status === 'anon') return <AuthPage />;
  if (status === 'onboarding') return <OnboardingWizard />;
  return <Workspace />;
};

export default App;
