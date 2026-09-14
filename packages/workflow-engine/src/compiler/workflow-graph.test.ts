/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/compiler/src/workflow-graph.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../common/index.js';
import {
  CircularWorkflowError,
  assertNoWorkflowCycles,
  referencedWorkflowIds,
} from './workflow-graph.js';
import type { WorkflowDef } from '../common/index.js';

/** A workflow whose single pipeline dispatches each referenced workflow. */
function workflow(id: string, references: string[] = []): WorkflowDef {
  return parseWorkflow({
    id,
    name: id,
    pipelines: [
      {
        id: 'main',
        name: 'main',
        pipes: [
          { id: 'src', role: 'source', type: 'source.triggerPayload', config: {} },
          ...references.map((target, index) => ({
            id: `sub-${index}`,
            role: 'transform',
            type: 'workflow.sub',
            config: { workflowId: target },
          })),
        ],
        edges: references.map((_, index) => ({
          from: 'src',
          to: `sub-${index}`,
        })),
      },
    ],
  });
}

function lookupIn(defs: WorkflowDef[]) {
  const byId = new Map(defs.map((def) => [def.id, def]));
  return async (id: string) => byId.get(id);
}

describe('workflow reference graph', () => {
  it('collects sub-workflow references', () => {
    expect(referencedWorkflowIds(workflow('a', ['b', 'c', 'b']))).toEqual([
      'b',
      'c',
    ]);
    expect(referencedWorkflowIds(workflow('a'))).toEqual([]);
  });

  it('accepts chains, diamonds, and forward references', async () => {
    const a = workflow('a', ['b']);
    const b = workflow('b', ['c', 'd']);
    const c = workflow('c', ['d']);
    const d = workflow('d');
    await expect(
      assertNoWorkflowCycles(a, lookupIn([a, b, c, d])),
    ).resolves.toBeUndefined();
    // Forward reference to a workflow that is not saved yet is legal.
    await expect(
      assertNoWorkflowCycles(workflow('x', ['not-saved-yet']), lookupIn([])),
    ).resolves.toBeUndefined();
  });

  it('reports a cycle with its full path', async () => {
    const a = workflow('a', ['b']);
    const b = workflow('b', ['c']);
    const c = workflow('c', ['a']);
    const failure = assertNoWorkflowCycles(a, lookupIn([a, b, c]));
    await expect(failure).rejects.toBeInstanceOf(CircularWorkflowError);
    await expect(failure).rejects.toThrow(
      'Circular Workflow Dependency: a → b → c → a',
    );
  });

  it('rejects a self-reference', async () => {
    const a = workflow('a', ['a']);
    await expect(assertNoWorkflowCycles(a, lookupIn([a]))).rejects.toThrow(
      'Circular Workflow Dependency: a → a',
    );
  });
});
