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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, GitBranch, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { LokeeWeavePage } from './LokeeWeavePage';
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
  const targetVersionId = useLokeeHistoryStore((s) => s.targetVersionId);
  const [databases, setDatabases] = useState<LokeeDatabase[]>([]);
  const [captureConnectionId, setCaptureConnectionId] = useState('');
  const [dto, setDto] = useState<VersionGraphDTO>(EMPTY_DTO);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<SchemaObjectNodeData | null>(null);
  // Bumped to re-run the effect; a plain refetch() would race the in-flight one.
  const [reloadToken, setReloadToken] = useState(0);

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

  useEffect(() => {
    if (!captureConnectionId && selectedTargetConnectionId) {
      setCaptureConnectionId(selectedTargetConnectionId);
    }
  }, [captureConnectionId, selectedTargetConnectionId]);

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
  }, [captureConnectionId, capturing, connections, refresh, bumpLokeeEpoch, setStoreDatabaseId]);

  const chrome = (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/80 px-4 py-2"
      data-testid="lokee-weave-chrome"
    >
      {!embedded && (
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
        History
        <select
          data-testid="lokee-database-select"
          value={activeId ?? ''}
          disabled={Boolean(databaseId) || databases.length === 0}
          onChange={(e) => setStoreDatabaseId(e.target.value || null)}
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-600 disabled:opacity-50"
        >
          {databases.length === 0 && <option value="">No captures yet</option>}
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {lokeeDatabaseLabel(d)}
            </option>
          ))}
        </select>
      </label>
      )}
      <button
        type="button"
        data-testid="lokee-refresh-btn"
        onClick={refresh}
        className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
        title="Reload databases and graph"
      >
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={SQL_ICON_STROKE} />
        Refresh
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <select
          data-testid="lokee-capture-connection"
          value={captureConnectionId}
          onChange={(e) => setCaptureConnectionId(e.target.value)}
          className="max-w-[16rem] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-600"
        >
          <option value="">Credential to capture…</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} [{c.dialect}]
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="lokee-capture-btn"
          disabled={!captureConnectionId || capturing}
          onClick={() => void runCapture()}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 text-[11px] font-bold text-cyan-100 hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          title="Read the live schema and record a version when anything changed"
        >
          {capturing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={SQL_ICON_STROKE} />
          ) : (
            <Camera className="h-3.5 w-3.5" strokeWidth={SQL_ICON_STROKE} />
          )}
          {capturing ? 'Capturing…' : 'Capture schema'}
        </button>
      </div>
    </div>
  );

  // Every hook above any early return — a rules-of-hooks crash has happened in
  // this codebase before.
  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden" data-testid="lokee-weave-view">
        {chrome}
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
        {chrome}
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
        {chrome}
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
      {chrome}
      {dto.truncatedObjects && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-200">
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
            compareVersionIds={compareVersionIds}
            onSelectObject={handleSelectObject}
            onSaveVersionMeta={saveVersionMeta}
          />
        </div>
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
