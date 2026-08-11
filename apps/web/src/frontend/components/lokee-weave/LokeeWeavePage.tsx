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
import React, { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
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
  type GraphChangeStatus,
  type LokeeEdgeData,
  type SchemaObjectNodeData,
  type VersionGraphDTO,
  type VersionGraphFilters,
} from './graphTypes';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

export interface LokeeWeavePageProps {
  dto: VersionGraphDTO;
  /** Connection label for the header, e.g. `[postgres] localhost/foxdb`. */
  subtitle?: string;
  onSelectObject?: (selected: SchemaObjectNodeData) => void;
}

const FILTERABLE_TYPES: LokeeObjectType[] = ['table', 'view', 'index', 'column'];
const STATUSES: GraphChangeStatus[] = ['added', 'modified', 'unchanged', 'deleted'];

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

export const LokeeWeavePage: React.FC<LokeeWeavePageProps> = ({
  dto,
  subtitle,
  onSelectObject,
}) => {
  const [filters, setFilters] = useState<VersionGraphFilters>(() => ({
    ...EMPTY_FILTERS,
    objectTypes: new Set(),
    statuses: new Set(),
  }));
  const [locked, setLocked] = useState(true);

  const built = useMemo(
    () => buildVersionGraph(dto, filters, DEFAULT_LAYOUT, MAX_VISIBLE_OBJECT_NODES),
    [dto, filters]
  );
  // Edge styling is separated from graph building so toggling a filter does not
  // re-run layout for every node.
  const edges = useMemo(() => styleEdges(built.edges), [built.edges]);

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

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'versionNode') return;
      onSelectObject?.(node.data as SchemaObjectNodeData);
    },
    [onSelectObject]
  );

  const changed = dto.objects.filter((o) => o.status !== 'unchanged').length;
  const reused = dto.objects.length - changed;

  return (
    <div data-testid="lokee-weave-page" className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-100">Lokee Weave</h1>
          <p className="text-xs text-slate-500">
            Database Schema Version Graph{subtitle ? ` · ${subtitle}` : ''}
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

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-[190px] shrink-0 flex-col gap-2 overflow-y-auto text-[11px]">
          <SidebarSection title="Legend">
            <ul className="flex flex-col gap-1">
              {(['table', 'view', 'index', 'column'] as LokeeObjectType[]).map((t) => (
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

          <SidebarSection title="Filters">
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
          </SidebarSection>
        </aside>

        <div className="relative min-w-0 flex-1 rounded-lg border border-slate-700">
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
                fitView
                proOptions={{ hideAttribution: false }}
              >
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

      <footer className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-[10px] text-slate-400">
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
