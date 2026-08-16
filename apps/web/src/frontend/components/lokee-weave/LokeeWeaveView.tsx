/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave — the container that fetches history and hands it to the graph.
 *
 * `LokeeWeavePage` stays a pure function of its DTO. Everything that can fail,
 * load, or be empty is handled here, so the graph itself remains trivially
 * testable with a fixture and has no idea a network exists.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, GitBranch, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { LokeeWeavePage } from './LokeeWeavePage';
import { VersionCompareModal } from './VersionCompareModal';
import { versionDisplayName } from './graphTypes';
import { LokeeObjectInspector } from './LokeeObjectInspector';
import type { SchemaObjectNodeData, VersionGraphDTO } from './graphTypes';
import {
  captureSchema,
  listLokeeDatabases,
  loadVersionGraph,
  updateLokeeVersionMeta,
  type LokeeDatabase,
} from '../../api/lokeeApi';
import { getSessionPassword } from '../../lib/sessionPasswords';
import { toast } from '../../store/toastStore';
import { useSyncStore } from '../../store/useSyncStore';
import { useUiStore } from '../../store/uiStore';
import { useLokeeHistoryStore } from '../../store/lokeeHistoryStore';
import { lokeeDatabaseLabel, resolveHistoryCompare } from '../../lib/historyCompare';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

export interface LokeeWeaveViewProps {
  /** When set, that database is shown; otherwise the picker / most recent one is. */
  databaseId?: string;
  /** How many versions to draw. The backend caps this well below the UI cap. */
  versionLimit?: number;
  onSelectObject?: (selected: SchemaObjectNodeData) => void;
  /** Compact chrome when mounted inside Schema Sync rather than as its own workspace. */
  embedded?: boolean;
}

const EMPTY_DTO: VersionGraphDTO = {
  databaseId: '',
  versions: [],
  objects: [],
  totalVersions: 0,
  totalObjects: 0,
  truncatedObjects: false,
};

function describe(database: LokeeDatabase | undefined): string | undefined {
  if (!database) return undefined;
  const where = [database.host, database.database].filter(Boolean).join('/');
  const schema = database.schema ? `.${database.schema}` : '';
  return `[${database.dialect}] ${where}${schema}`;
}

export function LokeeWeaveView({
  databaseId,
  versionLimit = 20,
  onSelectObject,
  embedded = false,
}: LokeeWeaveViewProps): React.ReactElement {
  const connections = useSyncStore((s) => s.connections);
  const selectedTargetConnectionId = useSyncStore((s) => s.selectedTargetConnectionId);
  const targetConfig = useSyncStore((s) => s.targetConfig);
  const lokeeEpoch = useUiStore((s) => s.lokeeEpoch);
  const bumpLokeeEpoch = useUiStore((s) => s.bumpLokeeEpoch);
  const storeDatabaseId = useLokeeHistoryStore((s) => s.databaseId);
  const setStoreDatabaseId = useLokeeHistoryStore((s) => s.setDatabaseId);
  const setStoreDatabases = useLokeeHistoryStore((s) => s.setDatabases);
  const setStoreVersions = useLokeeHistoryStore((s) => s.setVersions);
  const originalVersionId = useLokeeHistoryStore((s) => s.originalVersionId);
  const captureConnectionId = useLokeeHistoryStore((s) => s.captureConnectionId);
  const setCaptureConnectionId = useLokeeHistoryStore((s) => s.setCaptureConnectionId);
  const capturing = useLokeeHistoryStore((s) => s.capturing);
  const setCapturing = useLokeeHistoryStore((s) => s.setCapturing);
  const captureRequest = useLokeeHistoryStore((s) => s.captureRequest);
  const refreshRequest = useLokeeHistoryStore((s) => s.refreshRequest);
  const targetVersionId = useLokeeHistoryStore((s) => s.targetVersionId);
  const [databases, setDatabases] = useState<LokeeDatabase[]>([]);

  const [dto, setDto] = useState<VersionGraphDTO>(EMPTY_DTO);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<SchemaObjectNodeData | null>(null);
  // Bumped to re-run the effect; a plain refetch() would race the in-flight one.
  const [reloadToken, setReloadToken] = useState(0);
  // Which pair the modal is showing. The two *sides* live in the history store,
  // because the picker that sets them is HistoryCompareBar up in the toolbar.
  const [comparePair, setComparePair] = useState<{ original: string; target: string } | null>(null);

  const matchedTargetId = useMemo(() => {
    const host = (targetConfig.option.host ?? '').toLowerCase();
    const database = (targetConfig.option.database ?? '').toLowerCase();
    const schemaName = (targetConfig.schema ?? '').toLowerCase();
    const dialect = targetConfig.dialect.toLowerCase();
    return databases.find(
      (d) =>
        d.dialect.toLowerCase() === dialect &&
        (d.host ?? '').toLowerCase() === host &&
        (d.database ?? '').toLowerCase() === database &&
        (d.schema ?? '').toLowerCase() === schemaName
    )?.id;
  }, [databases, targetConfig]);

  const storedId =
    storeDatabaseId &&
    (databases.length === 0 || databases.some((d) => d.id === storeDatabaseId))
      ? storeDatabaseId
      : undefined;
  // Prop wins; otherwise the History Original picker; otherwise Target; else most recent.
  const activeId = databaseId ?? storedId ?? matchedTargetId ?? databases[0]?.id;

  useEffect(() => {
    setStoreDatabases(databases);
  }, [databases, setStoreDatabases]);

  useEffect(() => {
    if (databaseId) return;
    if (activeId && storeDatabaseId !== activeId) setStoreDatabaseId(activeId);
  }, [databaseId, activeId, storeDatabaseId, setStoreDatabaseId]);

  useEffect(() => {
    setStoreVersions(
      dto.versions.map((v) => ({ id: v.id, number: v.number, name: v.name }))
    );
  }, [dto.versions, setStoreVersions]);

  const compareVersionIds = useMemo(() => {
    const resolved = resolveHistoryCompare(
      dto.versions.map((v) => ({ id: v.id, number: v.number, name: v.name })),
      { originalVersionId, targetVersionId }
    );
    const ids = [resolved.original?.id, resolved.target?.id].filter(
      (id): id is string => Boolean(id)
    );
    return [...new Set(ids)];
  }, [dto.versions, originalVersionId, targetVersionId]);

  /**
   * Default the capture credential to the saved connection that *is* the history
   * database being viewed. Two connection-shaped controls sitting side by side
   * with unrelated values is what made the bar read as "which of these two
   * databases am I looking at?" — when they are the same database, one recorded
   * and one live. Compare's Target is the fallback, as before.
   */
  const activeDatabase = useMemo(
    () => databases.find((d) => d.id === activeId),
    [databases, activeId]
  );
  const matchingCredentialId = useMemo(() => {
    if (!activeDatabase) return undefined;
    const same = (a?: string | null, b?: string | null) =>
      (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
    return connections.find(
      (c) =>
        same(c.dialect, activeDatabase.dialect) &&
        same(c.host, activeDatabase.host) &&
        same(c.database, activeDatabase.database)
    )?.id;
  }, [connections, activeDatabase]);

  useEffect(() => {
    if (captureConnectionId) return;
    const next = matchingCredentialId ?? selectedTargetConnectionId;
    if (next) setCaptureConnectionId(next);
  }, [
    captureConnectionId,
    matchingCredentialId,
    selectedTargetConnectionId,
    setCaptureConnectionId,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listLokeeDatabases();
        if (!cancelled) setDatabases(rows);
      } catch (err) {
        // A failure here is not fatal — the graph below reports its own error.
        if (!cancelled) setDatabases([]);
        void err;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, lokeeEpoch]);

  useEffect(() => {
    if (!activeId) {
      setDto(EMPTY_DTO);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const graph = await loadVersionGraph(activeId, versionLimit);
        if (cancelled) return;
        setDto(graph);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load schema history');
        setDto(EMPTY_DTO);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, versionLimit, reloadToken, lokeeEpoch]);

  const subtitle = useMemo(
    () => describe(databases.find((d) => d.id === activeId)),
    [databases, activeId]
  );

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  // HistoryCompareBar renders in TopToolbar, so it asks for work by bumping a
  // counter rather than holding a callback. 0 is the initial value — acting on
  // it would refetch on every mount.
  const seenRefreshRequest = useRef(refreshRequest);
  useEffect(() => {
    if (refreshRequest === seenRefreshRequest.current) return;
    seenRefreshRequest.current = refreshRequest;
    refresh();
  }, [refreshRequest, refresh]);

  const saveVersionMeta = useCallback(
    async (versionId: string, patch: { name: string; description: string }) => {
      if (!activeId) return;
      try {
        const version = await updateLokeeVersionMeta(activeId, versionId, patch);
        setDto((prev) => ({
          ...prev,
          versions: prev.versions.map((v) =>
            v.id === versionId
              ? {
                  ...v,
                  name: version.name,
                  description: version.description,
                  author: version.author ?? v.author,
                }
              : v
          ),
        }));
        toast({ tone: 'success', title: 'Version updated', body: 'Name and description saved.' });
      } catch (err) {
        toast({
          tone: 'warning',
          title: 'Could not save version',
          body: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    [activeId]
  );

  const handleSelectObject = useCallback(
    (selected: SchemaObjectNodeData) => {
      setSelectedObject(selected);
      onSelectObject?.(selected);
    },
    [onSelectObject]
  );

  const runCapture = useCallback(async () => {
    if (!captureConnectionId || capturing) return;
    const conn = connections.find((c) => c.id === captureConnectionId);
    if (!conn) {
      toast({ tone: 'warning', title: 'Pick a credential', body: 'Choose a saved connection to capture.' });
      return;
    }
    setCapturing(true);
    try {
      const result = await captureSchema({
        connectionId: captureConnectionId,
        password: getSessionPassword(captureConnectionId) || undefined,
        source: 'manual',
      });
      setStoreDatabaseId(result.databaseId);
      refresh();
      bumpLokeeEpoch();
      toast({
        tone: 'success',
        title: result.changed
          ? `Captured v${result.versionNumber}`
          : `No changes since v${result.versionNumber}`,
        body: result.changed
          ? `${result.changeCount} object change(s) · ${result.objectCount} objects`
          : 'Observation recorded on the version already at the head.',
      });
    } catch (err) {
      toast({
        tone: 'warning',
        title: 'Capture failed',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCapturing(false);
    }
  }, [
    captureConnectionId,
    capturing,
    connections,
    refresh,
    bumpLokeeEpoch,
    setStoreDatabaseId,
    setCapturing,
  ]);

  // Fire on the counter alone, through a ref. Depending on `runCapture` here
  // is an infinite loop: it reads `capturing`, and it also *sets* it, so every
  // toggle gives the callback a new identity, re-runs this effect while the
  // counter is still non-zero, and captures again. Caught by a hanging test.
  //
  // The baseline is whatever the counter held at mount, not zero: the store
  // outlives this component, so leaving History after a capture and coming
  // back would otherwise re-fire that request and snapshot the database again.
  const runCaptureRef = useRef(runCapture);
  runCaptureRef.current = runCapture;
  const seenCaptureRequest = useRef(captureRequest);
  useEffect(() => {
    if (captureRequest === seenCaptureRequest.current) return;
    seenCaptureRequest.current = captureRequest;
    void runCaptureRef.current();
  }, [captureRequest]);




  // HistoryCompareBar's Target card owns the Compare button now, so this view
  // only has to open the modal for the pair the bar resolved.
  const compareRequest = useLokeeHistoryStore((s) => s.compareRequest);
  const seenCompareRequest = useRef(compareRequest);
  useEffect(() => {
    if (compareRequest === seenCompareRequest.current) return;
    seenCompareRequest.current = compareRequest;
    if (compareVersionIds.length === 2) {
      setComparePair({ original: compareVersionIds[0]!, target: compareVersionIds[1]! });
    }
  }, [compareRequest, compareVersionIds]);

  // Every hook above any early return — a rules-of-hooks crash has happened in
  // this codebase before.
  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden" data-testid="lokee-weave-view">
          <div className="flex flex-1 items-center justify-center text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={SQL_ICON_STROKE} />
          Loading schema history…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden" data-testid="lokee-weave-view">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <TriangleAlert className="h-6 w-6 text-rose-400" strokeWidth={SQL_ICON_STROKE} />
          <div className="text-sm font-semibold text-slate-100">Could not load schema history</div>
          <div className="max-w-md text-xs text-slate-400">{error}</div>
          <button
            type="button"
            onClick={refresh}
            className="mt-1 flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={SQL_ICON_STROKE} />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!activeId || dto.versions.length === 0) {
    return (
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden" data-testid="lokee-weave-view">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <GitBranch className="h-6 w-6 text-slate-500" strokeWidth={SQL_ICON_STROKE} />
          <div className="text-sm font-semibold text-slate-100">No schema history yet</div>
          <div className="max-w-md text-xs text-slate-400">
            Take an initial snapshot of the Target (Snapshot target in the toolbar), or pick a
            credential here and click <span className="text-slate-200">Capture schema</span>.
            Then choose an Original version and a Target (current database or an older version),
            the same way as Compare. Migrating the Target records a new version automatically.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden" data-testid="lokee-weave-view">
      {dto.truncatedObjects && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-1.5 text-[11px] text-amber-200">
          Showing the objects that changed in this window. This schema has more objects than the
          graph draws at once.
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <LokeeWeavePage
            dto={dto}
            subtitle={subtitle}
            embedded={embedded}
            onSelectObject={handleSelectObject}
            onSaveVersionMeta={saveVersionMeta}
          />
        </div>
        {comparePair && activeId && (
          <VersionCompareModal
            databaseId={activeId}
            versionId={comparePair.original}
            againstVersionId={comparePair.target}
            captureConnectionId={captureConnectionId || undefined}
            onReverted={refresh}
            onClose={() => setComparePair(null)}
          />
        )}
        {selectedObject && activeId && (
          <LokeeObjectInspector
            databaseId={activeId}
            selected={selectedObject}
            captureConnectionId={captureConnectionId || undefined}
            onClose={() => setSelectedObject(null)}
            onSelectVersion={(versionId) => {
              setSelectedObject((prev) => {
                if (!prev) return prev;
                const at = dto.objects.find(
                  (o) => o.objectKey === prev.objectKey && o.versionId === versionId
                );
                return {
                  ...prev,
                  versionId,
                  objectHash: at?.objectHash ?? prev.objectHash,
                  status: at?.status ?? prev.status,
                };
              });
            }}
            onReverted={() => {
              setSelectedObject(null);
              refresh();
              bumpLokeeEpoch();
            }}
          />
        )}
      </div>
    </div>
  );
}
