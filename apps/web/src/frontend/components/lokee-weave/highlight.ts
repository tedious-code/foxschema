/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Make the clicked node visible in a graph with two hundred cards in it.
 *
 * The node renderers already ring a `selected` node, but the graph is fully
 * controlled — `nodes` is rebuilt from the DTO on every render and there is no
 * `onNodesChange` — so React Flow's own selection had nowhere to be written
 * back to and `selected` was never true. Clicking opened the inspector and the
 * graph looked untouched.
 *
 * So selection is applied here, from the app's state, rather than borrowed from
 * React Flow's. And a ring alone is not enough at this scale: an object lives
 * in one column for its whole life, so clicking it also lights that column's
 * other versions and the edges joining them, and fades everything else. That
 * lineage is what the graph is *for*.
 *
 * Presentation only. Nothing here reads or writes stored history.
 */
import type { Edge, Node } from '@xyflow/react';

export type GraphSelection =
  | { kind: 'version'; versionId: string }
  | { kind: 'object'; versionId: string; objectKey: string }
  | null;

/** Node id conventions, mirroring `buildGraph`. */
export const versionNodeId = (versionId: string) => `version:${versionId}`;
export const objectNodeId = (versionId: string, objectKey: string) =>
  `object:${versionId}:${objectKey}`;

const CYAN = 'rgb(34 211 238)';

/** The clicked card: a solid ring plus lift, so it reads first. */
const SELECTED_STYLE = {
  outline: `2px solid ${CYAN}`,
  outlineOffset: '2px',
  borderRadius: '10px',
  filter: `drop-shadow(0 0 10px rgb(34 211 238 / 0.45))`,
} as const;

/** Other versions of the same object: related, but not what was clicked. */
const LINEAGE_STYLE = {
  outline: `1px dashed rgb(34 211 238 / 0.6)`,
  outlineOffset: '2px',
  borderRadius: '10px',
} as const;

/**
 * Faded, not hidden. A dimmed node still shows the shape of the history around
 * the thing you picked; removing it would make the graph jump on every click.
 */
const DIMMED_STYLE = { opacity: 0.28 } as const;

interface Highlighted<N extends Node, E extends Edge> {
  nodes: N[];
  edges: E[];
}

/**
 * Stamp selection onto a built graph.
 *
 * Returns the arrays unchanged (same references) when nothing is selected, so
 * the common case costs nothing and React Flow sees no new props.
 */
export function applyGraphHighlight<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  selection: GraphSelection
): Highlighted<N, E> {
  if (!selection) return { nodes, edges };

  const selectedId =
    selection.kind === 'version'
      ? versionNodeId(selection.versionId)
      : objectNodeId(selection.versionId, selection.objectKey);

  /** True for a node that belongs to the thing selected, clicked or not. */
  const related = (node: N): boolean => {
    if (node.id === selectedId) return true;
    if (selection.kind === 'version') {
      // A version's row: the version card and every object drawn against it.
      return (node.data as { versionId?: string }).versionId === selection.versionId;
    }
    // An object's column: the same logical object at every version it existed.
    return (node.data as { objectKey?: string }).objectKey === selection.objectKey;
  };

  const nextNodes = nodes.map((node) => {
    const isSelected = node.id === selectedId;
    const inFamily = related(node);
    return {
      ...node,
      selected: isSelected,
      // Lift the highlighted column above its neighbours; cards overlap when
      // the graph is zoomed out.
      zIndex: isSelected ? 20 : inFamily ? 10 : 1,
      style: {
        ...node.style,
        ...(isSelected ? SELECTED_STYLE : inFamily ? LINEAGE_STYLE : DIMMED_STYLE),
      },
    };
  });

  const nextEdges = edges.map((edge) => {
    const data = edge.data as { objectKey?: string } | undefined;
    const onLineage =
      selection.kind === 'object'
        ? data?.objectKey === selection.objectKey
        : // A version selection has no single thread to trace, so the spine
          // and the edges landing on that version stay lit.
          edge.target === versionNodeId(selection.versionId) ||
          edge.source === versionNodeId(selection.versionId) ||
          edge.target.startsWith(`object:${selection.versionId}:`) ||
          edge.source.startsWith(`object:${selection.versionId}:`);
    return {
      ...edge,
      animated: onLineage && selection.kind === 'object',
      zIndex: onLineage ? 10 : 0,
      style: {
        ...edge.style,
        ...(onLineage
          ? { stroke: CYAN, strokeWidth: 2.5, opacity: 1 }
          : { opacity: 0.18 }),
      },
    };
  });

  return { nodes: nextNodes, edges: nextEdges };
}
