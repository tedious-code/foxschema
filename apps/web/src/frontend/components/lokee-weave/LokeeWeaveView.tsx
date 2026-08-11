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
import { GitBranch, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { LokeeWeavePage } from './LokeeWeavePage';
import type { SchemaObjectNodeData, VersionGraphDTO } from './graphTypes';
import {
  listLokeeDatabases,
  loadVersionGraph,
  type LokeeDatabase,
} from '../../api/lokeeApi';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

export interface LokeeWeaveViewProps {
  /** When set, that database is shown; otherwise the most recent one is. */
  databaseId?: string;
  /** How many versions to draw. The backend caps this well below the UI cap. */
  versionLimit?: number;
  onSelectObject?: (selected: SchemaObjectNodeData) => void;
}

const EMPTY_DTO: VersionGraphDTO = {
  databaseId: '',
  versions: [],
  objects: [],
  totalVersions: 0,
  totalObjects: 0,
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
}: LokeeWeaveViewProps): React.ReactElement {
  const [databases, setDatabases] = useState<LokeeDatabase[]>([]);
  const [dto, setDto] = useState<VersionGraphDTO>(EMPTY_DTO);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped to re-run the effect; a plain refetch() would race the in-flight one.
  const [reloadToken, setReloadToken] = useState(0);

  // Falls back to the most recently seen database so the view is useful before
  // any picker exists to choose one.
  const activeId = databaseId ?? databases[0]?.id;

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
  }, [reloadToken]);

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
        setTruncated(Boolean(graph.truncatedObjects));
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
  }, [activeId, versionLimit, reloadToken]);

  const subtitle = useMemo(
    () => describe(databases.find((d) => d.id === activeId)),
    [databases, activeId]
  );

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  // Every hook above any early return — a rules-of-hooks crash has happened in
  // this codebase before.
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={SQL_ICON_STROKE} />
        Loading schema history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
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
    );
  }

  if (!activeId || dto.versions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <GitBranch className="h-6 w-6 text-slate-500" strokeWidth={SQL_ICON_STROKE} />
        <div className="text-sm font-semibold text-slate-100">No schema history yet</div>
        <div className="max-w-md text-xs text-slate-400">
          Capture a schema to start a history. Every capture that finds a change adds a version;
          one that finds none is recorded as another observation of the version already at the head.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {truncated && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-200">
          Showing the objects that changed in this window. This schema has more objects than the
          graph draws at once.
        </div>
      )}
      <div className="min-h-0 flex-1">
        <LokeeWeavePage dto={dto} subtitle={subtitle} onSelectObject={onSelectObject} />
      </div>
    </div>
  );
}
