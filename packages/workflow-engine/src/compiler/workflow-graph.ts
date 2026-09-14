/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/compiler/src/workflow-graph.ts).
 */
import type { WorkflowDef } from '../common/index.js';

/** Pipe type that dispatches a child workflow run (see docs/engine-evolution.md). */
export const SUB_WORKFLOW_PIPE_TYPE = 'workflow.sub';

export class CircularWorkflowError extends Error {
  constructor(readonly path: string[]) {
    super(`Circular Workflow Dependency: ${path.join(' → ')}`);
    this.name = 'CircularWorkflowError';
  }
}

/** Workflow ids referenced by this workflow's `workflow.sub` pipes. */
export function referencedWorkflowIds(workflow: WorkflowDef): string[] {
  const ids = new Set<string>();
  for (const pipeline of workflow.pipelines) {
    for (const pipe of pipeline.pipes) {
      if (pipe.type !== SUB_WORKFLOW_PIPE_TYPE) continue;
      const target = pipe.config['workflowId'];
      if (typeof target === 'string' && target.length > 0) ids.add(target);
    }
  }
  return [...ids];
}

/**
 * Layers 1–2 of circular workflow detection: DFS over declared sub-workflow
 * references with a visited set and an in-progress stack. A node found on the
 * stack is a cycle — reported with its full path. Unknown references are
 * skipped (forward references to not-yet-saved workflows are legal at save
 * time; the runtime ancestor-chain guard is the airtight layer).
 */
export async function assertNoWorkflowCycles(
  root: WorkflowDef,
  lookup: (id: string) => Promise<WorkflowDef | undefined>,
): Promise<void> {
  const safe = new Set<string>();
  const stack: string[] = [];

  async function visit(workflow: WorkflowDef): Promise<void> {
    if (safe.has(workflow.id)) return;
    const stackIndex = stack.indexOf(workflow.id);
    if (stackIndex >= 0) {
      throw new CircularWorkflowError([
        ...stack.slice(stackIndex),
        workflow.id,
      ]);
    }
    stack.push(workflow.id);
    try {
      for (const target of referencedWorkflowIds(workflow)) {
        const cycleIndex = stack.indexOf(target);
        if (cycleIndex >= 0) {
          throw new CircularWorkflowError([...stack.slice(cycleIndex), target]);
        }
        const definition = await lookup(target);
        if (definition) await visit(definition);
      }
    } finally {
      stack.pop();
    }
    safe.add(workflow.id);
  }

  await visit(root);
}
