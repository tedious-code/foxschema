/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (components/PipeEdge.tsx).
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

export type PipeEdgeData = {
  /** Named source port this edge leaves (`true` / `false` / `rejects` / …). */
  branch?: string;
};

export type PipeEdgeType = Edge<PipeEdgeData, 'pipe'>;

const BRANCH_LABEL: Record<string, string> = {
  true: 'Yes',
  false: 'No',
  rejects: 'Rejects',
};

/** Smooth-step edge with a Yes/No/Rejects pill when leaving a named port. */
export function PipeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  selected,
}: EdgeProps<PipeEdgeType>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const branch = data?.branch;
  const label = branch ? (BRANCH_LABEL[branch] ?? branch) : null;
  const branchClass = branch ? ` branch-${branch}` : '';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
        className={selected ? 'pipe-edge selected' : 'pipe-edge'}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`pipe-edge-label${branchClass}${selected ? ' selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
