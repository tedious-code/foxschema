/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave graph — node renderers.
 *
 * Nodes stay deliberately thin: an icon, a name, a short hash, a status dot.
 * Everything else belongs in the inspector, because a graph that tries to show
 * a table's columns inline stops being readable at about four tables.
 */
import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Table2,
  Eye,
  Layers,
  Columns3,
  KeyRound,
  Link2,
  Zap,
  Hash,
  FunctionSquare,
  Terminal,
  Shapes,
  GitCommitVertical,
  X,
} from 'lucide-react';
import type { LokeeObjectType } from '@foxschema/sql';
import { objectStyle, statusStyle } from '../../lib/lokeeColors';
import { shortHash, type SchemaObjectNodeData, type VersionNodeData } from './graphTypes';
import { SQL_ICON_STROKE } from '../sql-editor/sqlIconStyle';

/** Reuses the app's icon set rather than introducing a second one. */
const TYPE_ICON: Record<LokeeObjectType, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  table: Table2,
  mqt: Layers,
  view: Eye,
  column: Columns3,
  index: Hash,
  primary_key: KeyRound,
  foreign_key: Link2,
  trigger: Zap,
  sequence: Shapes,
  function: FunctionSquare,
  procedure: Terminal,
  type: Shapes,
};

export const VersionNode = memo(({ data, selected }: NodeProps) => {
  const d = data as VersionNodeData;
  const when = d.createdAt.replace('T', ' ').slice(0, 16);
  return (
    <div
      data-testid={`rf-version-${d.versionId}`}
      aria-label={`Version ${d.versionNumber}, ${d.changeCount} changes`}
      className={`w-[190px] rounded-lg border bg-slate-900/80 px-3 py-2 ${
        selected ? 'border-violet-400 ring-1 ring-violet-400/60' : 'border-violet-500/40'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-2">
        <GitCommitVertical className="w-4 h-4 text-violet-300" strokeWidth={SQL_ICON_STROKE} />
        <span className="text-sm font-bold text-slate-100">Version {d.versionNumber}</span>
      </div>
      <div className="mt-0.5 pl-6 text-[10px] text-slate-400">{when}</div>
      {d.author && <div className="pl-6 text-[10px] text-slate-500 truncate">{d.author}</div>}
      {d.changeCount > 0 && (
        <div className="mt-1 pl-6 text-[10px] font-semibold text-amber-300">
          {d.changeCount} changed
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});
VersionNode.displayName = 'VersionNode';

export const SchemaObjectNode = memo(({ data, selected }: NodeProps) => {
  const d = data as SchemaObjectNodeData;
  const style = objectStyle(d.objectType);
  const status = statusStyle(d.status);
  const Icon = TYPE_ICON[d.objectType] ?? Shapes;
  return (
    <div
      data-testid={`rf-object-${d.versionId}-${d.objectKey}`}
      // Status must be reachable without seeing colour.
      aria-label={`${style.label} ${d.name}, ${status.label}`}
      title={`${d.objectKey}\n${status.label}\nhash ${d.objectHash ?? '—'}`}
      className={`w-[150px] rounded-lg border bg-slate-900/80 px-2 py-1.5 ${status.accent} ${
        selected ? 'ring-2 ring-cyan-400/70' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${style.dot.replace('bg-', 'text-')}`} strokeWidth={SQL_ICON_STROKE} />
        <span className="truncate text-[11px] font-semibold text-slate-100">{d.name}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1 pl-5">
        <span className="font-mono text-[10px] text-slate-400">{shortHash(d.objectHash)}</span>
        <span
          className={`ml-auto h-2 w-2 shrink-0 rounded-full ${status.dot}`}
          aria-hidden
        />
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});
SchemaObjectNode.displayName = 'SchemaObjectNode';

/** A tombstone marks where an object stopped existing; it is not carried on. */
export const DeletedObjectNode = memo(({ data, selected }: NodeProps) => {
  const d = data as SchemaObjectNodeData;
  return (
    <div
      data-testid={`rf-object-${d.versionId}-${d.objectKey}`}
      aria-label={`${d.name}, deleted in this version`}
      title={`${d.objectKey}\nDeleted in this version`}
      className={`w-[150px] rounded-lg border border-rose-500/60 bg-rose-500/10 px-2 py-1.5 ${
        selected ? 'ring-2 ring-cyan-400/70' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-1.5">
        <X className="w-3.5 h-3.5 shrink-0 text-rose-300" strokeWidth={SQL_ICON_STROKE} />
        <span className="truncate text-[11px] font-semibold text-rose-200 line-through">
          {d.name}
        </span>
      </div>
      <div className="mt-0.5 pl-5 text-[10px] text-rose-300/80">deleted</div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});
DeletedObjectNode.displayName = 'DeletedObjectNode';

export const LOKEE_NODE_TYPES = {
  versionNode: VersionNode,
  schemaObjectNode: SchemaObjectNode,
  deletedObjectNode: DeletedObjectNode,
};
