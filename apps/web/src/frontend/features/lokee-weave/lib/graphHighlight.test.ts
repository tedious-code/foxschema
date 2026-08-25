/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The rule these encode: a click lights one card, keeps its lineage legible,
 * and fades the rest — without ever hiding a node or touching stored history.
 */
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { applyGraphHighlight, objectNodeId, versionNodeId } from './graphHighlight';

/** Two versions, two objects each — CUSTOMERS lives in both. */
const nodes: Node[] = [
  { id: versionNodeId('v1'), position: { x: 0, y: 0 }, data: { versionId: 'v1' } },
  { id: versionNodeId('v2'), position: { x: 0, y: 100 }, data: { versionId: 'v2' } },
  {
    id: objectNodeId('v1', 'table:CUSTOMERS'),
    position: { x: 200, y: 0 },
    data: { versionId: 'v1', objectKey: 'table:CUSTOMERS' },
  },
  {
    id: objectNodeId('v2', 'table:CUSTOMERS'),
    position: { x: 200, y: 100 },
    data: { versionId: 'v2', objectKey: 'table:CUSTOMERS' },
  },
  {
    id: objectNodeId('v2', 'table:ORDERS'),
    position: { x: 380, y: 100 },
    data: { versionId: 'v2', objectKey: 'table:ORDERS' },
  },
];

const edges: Edge[] = [
  { id: 'version:v2:v1', source: versionNodeId('v2'), target: versionNodeId('v1') },
  {
    id: 'lineage:table:CUSTOMERS:v2:v1',
    source: objectNodeId('v2', 'table:CUSTOMERS'),
    target: objectNodeId('v1', 'table:CUSTOMERS'),
    data: { objectKey: 'table:CUSTOMERS', status: 'modified' },
  },
  {
    id: 'edge:orders',
    source: versionNodeId('v2'),
    target: objectNodeId('v2', 'table:ORDERS'),
    data: { objectKey: 'table:ORDERS', status: 'added' },
  },
];

const opacityOf = (node: Node) => (node.style as { opacity?: number } | undefined)?.opacity;
const outlineOf = (node: Node) => (node.style as { outline?: string } | undefined)?.outline;
const byId = (list: Node[], id: string) => list.find((n) => n.id === id)!;
const edgeById = (list: Edge[], id: string) => list.find((e) => e.id === id)!;

describe('no selection', () => {
  it('returns the same arrays, so React Flow sees no new props', () => {
    const out = applyGraphHighlight(nodes, edges, null);
    expect(out.nodes).toBe(nodes);
    expect(out.edges).toBe(edges);
  });
});

describe('object selection', () => {
  const out = applyGraphHighlight(nodes, edges, {
    kind: 'object',
    versionId: 'v2',
    objectKey: 'table:CUSTOMERS',
  });

  it('marks the clicked node selected — the ring the renderers already draw', () => {
    // This is the bug the module exists for: the graph is controlled and has no
    // onNodesChange, so React Flow could never set `selected` itself.
    expect(byId(out.nodes, objectNodeId('v2', 'table:CUSTOMERS')).selected).toBe(true);
    expect(byId(out.nodes, objectNodeId('v1', 'table:CUSTOMERS')).selected).toBe(false);
  });

  it('lights the same object at every other version', () => {
    expect(outlineOf(byId(out.nodes, objectNodeId('v1', 'table:CUSTOMERS')))).toContain('dashed');
    expect(opacityOf(byId(out.nodes, objectNodeId('v1', 'table:CUSTOMERS')))).toBeUndefined();
  });

  it('fades unrelated nodes without removing them', () => {
    const orders = byId(out.nodes, objectNodeId('v2', 'table:ORDERS'));
    expect(opacityOf(orders)).toBeLessThan(0.5);
    // Faded, not gone: the graph must not re-flow on a click.
    expect(out.nodes).toHaveLength(nodes.length);
  });

  it('lifts the highlighted column above overlapping neighbours', () => {
    expect(byId(out.nodes, objectNodeId('v2', 'table:CUSTOMERS')).zIndex).toBeGreaterThan(
      byId(out.nodes, objectNodeId('v2', 'table:ORDERS')).zIndex!
    );
  });

  it('traces the lineage edges and dims the others', () => {
    const lineage = edgeById(out.edges, 'lineage:table:CUSTOMERS:v2:v1');
    expect(lineage.animated).toBe(true);
    expect((lineage.style as { strokeWidth?: number }).strokeWidth).toBe(2.5);
    expect((edgeById(out.edges, 'edge:orders').style as { opacity?: number }).opacity).toBeLessThan(0.5);
  });

  it('does not mutate the input arrays', () => {
    expect(nodes.every((n) => n.selected === undefined)).toBe(true);
    expect(edges.every((e) => e.animated === undefined)).toBe(true);
  });
});

describe('version selection', () => {
  const out = applyGraphHighlight(nodes, edges, { kind: 'version', versionId: 'v2' });

  it('selects the version card and lights everything on its row', () => {
    expect(byId(out.nodes, versionNodeId('v2')).selected).toBe(true);
    expect(outlineOf(byId(out.nodes, objectNodeId('v2', 'table:ORDERS')))).toContain('dashed');
    expect(outlineOf(byId(out.nodes, objectNodeId('v2', 'table:CUSTOMERS')))).toContain('dashed');
  });

  it('fades the other version and its objects', () => {
    expect(opacityOf(byId(out.nodes, versionNodeId('v1')))).toBeLessThan(0.5);
    expect(opacityOf(byId(out.nodes, objectNodeId('v1', 'table:CUSTOMERS')))).toBeLessThan(0.5);
  });

  it('does not animate — a version has no single thread to trace', () => {
    expect(out.edges.every((e) => e.animated === false)).toBe(true);
  });
});

describe('a selection that no longer exists', () => {
  it('dims everything rather than throwing', () => {
    // The graph can be refiltered under a stale selection.
    const out = applyGraphHighlight(nodes, edges, {
      kind: 'object',
      versionId: 'v9',
      objectKey: 'table:GONE',
    });
    expect(out.nodes.every((n) => n.selected === false)).toBe(true);
    expect(out.nodes.every((n) => opacityOf(n)! < 0.5)).toBe(true);
  });
});
