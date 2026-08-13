/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave — schema version graph.
 *
 * Versions run down the left; each logical object holds one column for its
 * whole life so lineage can be followed by eye. Unchanged objects still occupy
 * their lane, joined by a dashed "reused" edge — the picture shows several
 * historical positions pointing at one immutable stored object, which is what
 * the storage engine actually does.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Lock, Unlock } from 'lucide-react';
import type { LokeeObjectType } from '@foxschema/sql';
import { OBJECT_STYLES, STATUS_STYLES, objectStyle, statusStyle } from '../../lib/lokeeColors';
import { LOKEE_NODE_TYPES } from './nodes';
import { buildVersionGraph } from './buildGraph';
import {
  DEFAULT_LAYOUT,
  EMPTY_FILTERS,
  MAX_VISIBLE_OBJECT_NODES,
  versionDisplayName,
  type GraphChangeStatus,
  type LokeeEdgeData,
  type SchemaObjectNodeData,
  type VersionGraphDTO,
  type VersionGraphFilters,
  type VersionGraphVersion,
  type VersionNodeData,
} from './graphTypes';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

export interface LokeeWeavePageProps {
  dto: VersionGraphDTO;
  /** Connection label for the header, e.g. `[postgres] localhost/foxdb`. */
  subtitle?: string;
  onSelectObject?: (selected: SchemaObjectNodeData) => void;
  /** Persist a version display name / description edit. */
  onSaveVersionMeta?: (
    versionId: string,
    patch: { name: string; description: string }
  ) => Promise<void>;
  /** Shorter header when shown inside Schema Sync. */
  embedded?: boolean;
}

const FILTERABLE_TYPES: LokeeObjectType[] = [
  'table',
  'view',
  'mqt',
  'index',
  'column',
  'trigger',
  'function',
  'procedure',
];
const STATUSES: GraphChangeStatus[] = ['added', 'modified', 'unchanged', 'deleted'];

/** When a schema has this many distinct objects, default to tables-only. */
const AUTO_TABLES_ONLY_AT = 20;

/** Fit the viewport to versions + this many object columns (readable size). */
const FIT_OBJECT_COLUMNS = 5;

function distinctObjectKeys(dto: VersionGraphDTO): number {
  return new Set(dto.objects.map((o) => o.objectKey)).size;
}

/** Edge styling lives here because React Flow styles edges inline, not by class. */
function styleEdges(edges: Edge[]): Edge[] {
  return edges.map((edge) => {
    const data = edge.data as LokeeEdgeData | undefined;
    const isVersionSpine = edge.id.startsWith('version:');
    if (isVersionSpine) {
      return {
        ...edge,
        style: { stroke: 'var(--color-violet-400)', strokeWidth: 2 },
        animated: false,
      };
    }
    const status =
      data?.status === 'reused'
        ? STATUS_STYLES.unchanged!
        : data?.status === 'modified'
          ? STATUS_STYLES.modified!
          : data?.status === 'deleted'
            ? STATUS_STYLES.deleted!
            : STATUS_STYLES.added!;
    return {
      ...edge,
      style: {
        stroke: status.stroke,
        strokeWidth: 1.5,
        strokeDasharray: status.dashed ? '5 4' : undefined,
      },
      animated: false,
    };
  });
}

const SidebarSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="rounded-lg border border-slate-700 bg-slate-900/60 p-2.5">
    <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
      {title}
    </h3>
    {children}
  </section>
);

function freshFilters(objectTypes: Set<LokeeObjectType> = new Set()): VersionGraphFilters {
  return {
    ...EMPTY_FILTERS,
    objectTypes,
    statuses: new Set(),
    versionIds: new Set(),
    authors: new Set(),
  };
}

/**
 * Pin zoom to 1 and park the first version at the top-left. fitView on a wide
 * short strip either shrinks nodes to a speck or leaves a tiny viewport strip.
 */
function FitReadableView({ nodes }: { nodes: Node[] }) {
  const { setViewport } = useReactFlow();
  // Stable key so selection / label edits don't keep resetting the camera.
  const fitKey = (() => {
    const version = nodes.find((n) => n.type === 'versionNode');
    if (!version) return `n${nodes.length}`;
    return `${version.id}:${version.position.x},${version.position.y}:${nodes.length}`;
  })();
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled || nodes.length === 0) return;
      const version = nodes.find((n) => n.type === 'versionNode') ?? nodes[0]!;
      // React Flow viewport: screen = (world * zoom) + {x,y}. Place the first
      // version near the top-left inset of the pane at 100% zoom.
      const zoom = 1;
      const x = -version.position.x * zoom + 24;
      const y = -version.position.y * zoom + 24;
      void setViewport({ x, y, zoom }, { duration: 180 });
    };
    // Wait for layout + node measurement; one frame is often too early.
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(run);
    });
    const fallback = window.setTimeout(run, 150);
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      window.clearTimeout(fallback);
    };
  }, [fitKey, nodes, setViewport]);
  return null;
}

export const LokeeWeavePage: React.FC<LokeeWeavePageProps> = ({
  dto,
  subtitle,
  onSelectObject,
  onSaveVersionMeta,
  embedded = false,
}) => {
  const [filters, setFilters] = useState<VersionGraphFilters>(() => freshFilters());
  const [filtersBootstrapped, setFiltersBootstrapped] = useState(false);
  const [locked, setLocked] = useState(true);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Large schemas (columns+indexes+tables) make fitView zoom to invisibility —
  // start on tables only; the user can widen the type filter.
  useEffect(() => {
    if (filtersBootstrapped || dto.objects.length === 0) return;
    if (distinctObjectKeys(dto) >= AUTO_TABLES_ONLY_AT) {
      setFilters(freshFilters(new Set<LokeeObjectType>(['table'])));
    }
    setFiltersBootstrapped(true);
  }, [dto, filtersBootstrapped]);

  const selectedVersion: VersionGraphVersion | undefined = useMemo(
    () => dto.versions.find((v) => v.id === selectedVersionId),
    [dto.versions, selectedVersionId]
  );

  useEffect(() => {
    if (!selectedVersion) {
      setEditName('');
      setEditDescription('');
      return;
    }
    setEditName(selectedVersion.name ?? '');
    setEditDescription(selectedVersion.description ?? '');
  }, [selectedVersion]);

  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const v of dto.versions) {
      if (v.author?.trim()) set.add(v.author.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [dto.versions]);

  const versionsNewestFirst = useMemo(
    () => [...dto.versions].sort((a, b) => b.number - a.number),
    [dto.versions]
  );

  const built = useMemo(
    () => buildVersionGraph(dto, filters, DEFAULT_LAYOUT, MAX_VISIBLE_OBJECT_NODES),
    [dto, filters]
  );
  // Edge styling is separated from graph building so toggling a filter does not
  // re-run layout for every node.
  const edges = useMemo(() => styleEdges(built.edges), [built.edges]);
  const tablesOnly =
    filters.objectTypes.size === 1 && filters.objectTypes.has('table');
  const wideGraph = built.columns.length > FIT_OBJECT_COLUMNS;

  const toggleType = useCallback((type: LokeeObjectType) => {
    setFilters((f) => {
      const next = new Set(f.objectTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...f, objectTypes: next };
    });
  }, []);

  const toggleStatus = useCallback((status: GraphChangeStatus) => {
    setFilters((f) => {
      const next = new Set(f.statuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return { ...f, statuses: next };
    });
  }, []);

  const toggleVersion = useCallback((versionId: string) => {
    setFilters((f) => {
      const next = new Set(f.versionIds);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return { ...f, versionIds: next };
    });
  }, []);

  const toggleAuthor = useCallback((author: string) => {
    setFilters((f) => {
      const next = new Set(f.authors);
      if (next.has(author)) next.delete(author);
      else next.add(author);
      return { ...f, authors: next };
    });
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'versionNode') {
        const data = node.data as VersionNodeData;
        setSelectedVersionId(data.versionId);
        return;
      }
      setSelectedVersionId(null);
      onSelectObject?.(node.data as SchemaObjectNodeData);
    },
    [onSelectObject]
  );

  const saveVersionMeta = useCallback(async () => {
    if (!selectedVersionId || !onSaveVersionMeta || savingMeta) return;
    setSavingMeta(true);
    try {
      await onSaveVersionMeta(selectedVersionId, {
        name: editName,
        description: editDescription,
      });
    } finally {
      setSavingMeta(false);
    }
  }, [selectedVersionId, onSaveVersionMeta, savingMeta, editName, editDescription]);

  const changed = dto.objects.filter((o) => o.status !== 'unchanged').length;
  const reused = dto.objects.length - changed;

  return (
    <div data-testid="lokee-weave-page" className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-100">
            {embedded ? 'Schema history' : 'Lokee Weave'}
          </h1>
          <p className="text-xs text-slate-500">
            {embedded
              ? `Version timeline for the Target database${subtitle ? ` · ${subtitle}` : ''}`
              : `Database Schema Version Graph${subtitle ? ` · ${subtitle}` : ''}`}
          </p>
        </div>
        <div
          data-testid="lokee-summary"
          className="ml-auto rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300"
        >
          <div>
            Total Versions: <span className="font-bold text-slate-100">{dto.totalVersions}</span>
          </div>
          <div>
            Total Objects: <span className="font-bold text-slate-100">{dto.totalObjects}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            {changed} changed · {reused} reused
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <aside className="flex w-[220px] shrink-0 flex-col gap-2 overflow-y-auto text-[11px]">
          <SidebarSection title="Legend">
            <ul className="flex flex-col gap-1">
              {(
                ['table', 'view', 'mqt', 'index', 'column', 'trigger', 'function', 'procedure'] as LokeeObjectType[]
              ).map((t) => (
                <li key={t} className="flex items-center gap-2 text-slate-300">
                  <span className={`h-2 w-2 rounded-full ${objectStyle(t).dot}`} aria-hidden />
                  {OBJECT_STYLES[t].label}
                </li>
              ))}
            </ul>
          </SidebarSection>

          <SidebarSection title="Object status">
            <ul className="flex flex-col gap-1">
              {STATUSES.map((s) => (
                <li key={s} className="flex items-center gap-2 text-slate-300">
                  <span className={`h-2 w-2 rounded-full ${statusStyle(s).dot}`} aria-hidden />
                  {statusStyle(s).label}
                </li>
              ))}
            </ul>
          </SidebarSection>

          <SidebarSection title="Version">
            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
              {versionsNewestFirst.map((v) => (
                <label key={v.id} className="flex cursor-pointer items-start gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    data-testid={`lokee-rf-version-${v.id}`}
                    className="mt-0.5"
                    checked={filters.versionIds.size === 0 || filters.versionIds.has(v.id)}
                    onChange={() => toggleVersion(v.id)}
                  />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate font-medium">{versionDisplayName(v)}</span>
                    <span className="text-[10px] text-slate-500">v{v.number}</span>
                  </span>
                </label>
              ))}
            </div>
          </SidebarSection>

          <SidebarSection title="Status filter">
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  data-testid={`lokee-rf-status-${s}`}
                  aria-pressed={filters.statuses.has(s)}
                  onClick={() => toggleStatus(s)}
                  className={`rounded border px-1.5 py-0.5 transition ${
                    filters.statuses.has(s)
                      ? `${statusStyle(s).accent} text-slate-100`
                      : 'border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {statusStyle(s).label.split(' ')[0]}
                </button>
              ))}
            </div>
          </SidebarSection>

          <SidebarSection title="Date">
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-0.5 text-slate-400">
                From
                <input
                  type="date"
                  data-testid="lokee-rf-date-from"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                  className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-slate-400">
                To
                <input
                  type="date"
                  data-testid="lokee-rf-date-to"
                  value={filters.dateTo}
                  onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                  className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
                />
              </label>
            </div>
          </SidebarSection>

          <SidebarSection title="User">
            {authors.length === 0 ? (
              <p className="text-[10px] text-slate-500">No authors on these versions.</p>
            ) : (
              <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
                {authors.map((author) => (
                  <label key={author} className="flex cursor-pointer items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      data-testid={`lokee-rf-author-${author}`}
                      checked={filters.authors.size === 0 || filters.authors.has(author)}
                      onChange={() => toggleAuthor(author)}
                    />
                    <span className="truncate" title={author}>
                      {author}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </SidebarSection>

          <SidebarSection title="Object type">
            <div className="flex flex-col gap-1">
              {FILTERABLE_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    data-testid={`lokee-rf-type-${t}`}
                    // Unchecked-means-all: an empty set is "no filter", so the
                    // box reads as "showing this type".
                    checked={filters.objectTypes.size === 0 || filters.objectTypes.has(t)}
                    onChange={() => toggleType(t)}
                  />
                  Show {OBJECT_STYLES[t].label}s
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  data-testid="lokee-rf-show-deleted"
                  checked={filters.showDeleted}
                  onChange={() => setFilters((f) => ({ ...f, showDeleted: !f.showDeleted }))}
                />
                Show Deleted
              </label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 font-semibold text-amber-300">
                <input
                  type="checkbox"
                  data-testid="lokee-rf-changes-only"
                  checked={filters.changesOnly}
                  onChange={() => setFilters((f) => ({ ...f, changesOnly: !f.changesOnly }))}
                />
                Changes only
              </label>
            </div>
          </SidebarSection>

          {selectedVersion && (
            <SidebarSection title="Edit version">
              <div className="flex flex-col gap-1.5" data-testid="lokee-version-editor">
                <div className="text-[10px] text-slate-500">v{selectedVersion.number}</div>
                <label className="flex flex-col gap-0.5 text-slate-400">
                  Name
                  <input
                    type="text"
                    data-testid="lokee-version-name"
                    maxLength={120}
                    value={editName}
                    placeholder={`Version ${selectedVersion.number}`}
                    onChange={(e) => setEditName(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-slate-400">
                  Description
                  <textarea
                    data-testid="lokee-version-description"
                    maxLength={4000}
                    rows={3}
                    value={editDescription}
                    placeholder="Optional notes for this version"
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="resize-y rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
                  />
                </label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    data-testid="lokee-version-save"
                    disabled={!onSaveVersionMeta || savingMeta}
                    onClick={() => void saveVersionMeta()}
                    className="rounded border border-cyan-500/40 bg-cyan-950/40 px-2 py-1 text-[11px] font-semibold text-cyan-100 disabled:opacity-40"
                  >
                    {savingMeta ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    data-testid="lokee-version-close"
                    onClick={() => setSelectedVersionId(null)}
                    className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                  >
                    Close
                  </button>
                </div>
              </div>
            </SidebarSection>
          )}

          <SidebarSection title="Layout">
            <button
              type="button"
              data-testid="lokee-rf-lock"
              aria-pressed={locked}
              onClick={() => setLocked((v) => !v)}
              className="flex items-center gap-1.5 rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:text-slate-100"
            >
              {locked ? (
                <Lock className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} />
              ) : (
                <Unlock className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} />
              )}
              {locked ? 'Locked' : 'Unlocked'}
            </button>
            <p className="mt-1 text-[10px] leading-tight text-slate-500">
              Dragging is a view preference only — it never changes history.
            </p>
            <button
              type="button"
              data-testid="lokee-rf-clear-filters"
              onClick={() => setFilters(freshFilters())}
              className="mt-2 rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:text-slate-200"
            >
              Clear filters
            </button>
          </SidebarSection>
        </aside>

        <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-slate-700">
          {built.hiddenByCap > 0 && (
            <div
              data-testid="lokee-rf-capped"
              className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-200"
            >
              <AlertTriangle className="w-3 h-3" strokeWidth={SQL_ICON_STROKE} />
              Too many objects to render clearly — showing changed objects first (
              {built.hiddenByCap} hidden).
            </div>
          )}
          {tablesOnly && distinctObjectKeys(dto) >= AUTO_TABLES_ONLY_AT && (
            <div
              data-testid="lokee-rf-tables-only-hint"
              className={`absolute left-2 z-10 max-w-sm rounded border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[10px] text-sky-100 ${
                built.hiddenByCap > 0 ? 'top-10' : 'top-2'
              }`}
            >
              Showing <span className="font-semibold">tables</span> only so the graph stays
              readable ({distinctObjectKeys(dto)} objects total). Enable Views / Indexes /
              Columns in the sidebar, then pan right for more.
            </div>
          )}
          {!tablesOnly && wideGraph && (
            <div
              data-testid="lokee-rf-wide-hint"
              className={`absolute left-2 z-10 max-w-sm rounded border border-slate-600 bg-slate-900/90 px-2 py-1 text-[10px] text-slate-300 ${
                built.hiddenByCap > 0 ? 'top-10' : 'top-2'
              }`}
            >
              Large graph — zoomed to the left. Scroll / pan to explore, or filter object types.
            </div>
          )}
          {dto.versions.length === 0 ? (
            <div
              data-testid="lokee-rf-empty"
              className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500"
            >
              No schema changes recorded yet.
            </div>
          ) : (
            <ReactFlowProvider>
              <ReactFlow
                nodes={built.nodes}
                edges={edges}
                nodeTypes={LOKEE_NODE_TYPES}
                nodesDraggable={!locked}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={onNodeClick}
                minZoom={0.35}
                maxZoom={1.75}
                defaultViewport={{ x: 24, y: 24, zoom: 1 }}
                style={{ width: '100%', height: '100%' }}
                proOptions={{ hideAttribution: false }}
              >
                <FitReadableView nodes={built.nodes} />
                <Background gap={20} />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  // React Flow's default minimap is opaque white, which reads
                  // as a hole in the canvas under either theme.
                  className="!bg-slate-900"
                  maskColor="rgba(15,23,42,0.6)"
                  nodeColor={(n) =>
                    n.type === 'versionNode'
                      ? 'var(--color-violet-400)'
                      : n.type === 'deletedObjectNode'
                        ? 'var(--color-rose-400)'
                        : 'var(--color-sky-400)'
                  }
                />
              </ReactFlow>
            </ReactFlowProvider>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-4 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-[10px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-6 bg-slate-400" aria-hidden /> Created in this version
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-6 border-t border-dashed border-sky-400" aria-hidden />{' '}
          Reused from previous version
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-px w-6 border-t border-dashed border-amber-400"
            aria-hidden
          />{' '}
          Modified from previous version
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-px w-6 border-t border-dashed border-rose-400"
            aria-hidden
          />{' '}
          Deleted in this version
        </span>
      </footer>
    </div>
  );
};
