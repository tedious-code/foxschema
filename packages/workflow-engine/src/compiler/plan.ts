/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/compiler/src/plan.ts).
 */
import type { PipelineDef } from '../common/index.js';
import type { WorkflowDef } from '../common/index.js';

/**
 * A topologically ordered plan: `waves[i]` is the set of ids whose upstreams
 * are all satisfied by earlier waves. Members of a wave are independent and
 * eligible to run in parallel; the scheduler decides how many actually run at
 * once.
 */
export interface ExecutionPlan {
  waves: string[][];
  order: string[];
}

/** Kahn's algorithm over an id/edge list. Throws on a cycle. */
function topoPlan(
  ids: string[],
  edges: { from: string; to: string }[],
  graphLabel: string,
): ExecutionPlan {
  const indegree = new Map<string, number>();
  const downstream = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    downstream.set(id, []);
  }
  for (const edge of edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    downstream.get(edge.from)!.push(edge.to);
  }

  const waves: string[][] = [];
  const order: string[] = [];
  let ready = [...indegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort();

  let settled = 0;
  while (ready.length > 0) {
    waves.push(ready);
    const next: string[] = [];
    for (const id of ready) {
      order.push(id);
      settled++;
      for (const to of downstream.get(id) ?? []) {
        const deg = indegree.get(to)! - 1;
        indegree.set(to, deg);
        if (deg === 0) next.push(to);
      }
    }
    ready = next.sort();
  }

  if (settled !== ids.length) {
    throw new Error(`${graphLabel} graph contains a cycle`);
  }
  return { waves, order };
}

/**
 * Plan one pipeline's streaming DAG: waves of pipe ids. Sources (no inbound
 * edges) form wave 0.
 */
export function planExecution(pipeline: PipelineDef): ExecutionPlan {
  return topoPlan(
    pipeline.pipes.map((p) => p.id),
    pipeline.edges,
    `pipeline ${pipeline.id}`,
  );
}

/**
 * Plan a workflow's completion ordering: waves of pipeline ids, driven by the
 * workflow's dependency (completion) edges. Pipelines in the same wave have no
 * path between them and may run in parallel.
 */
export function planWorkflow(workflow: WorkflowDef): ExecutionPlan {
  return topoPlan(
    workflow.pipelines.map((p) => p.id),
    workflow.dependencies,
    'workflow',
  );
}

/**
 * Every pipeline needs a root that can *produce* records — a source or a
 * trigger payload. A pipeline whose roots are all transforms has nothing to
 * pull from and cannot run.
 *
 * The executor has always refused this, but only once a run had started, which
 * meant a workflow could be saved happily and then fail at 3am. Sharing the
 * rule lets the API reject it at save time while the engine keeps its own guard
 * for definitions that never went through the API (crash-resume snapshots,
 * embedders calling the executor directly).
 */
export function assertRunnableRoots(pipeline: PipelineDef): void {
  const inbound = new Set(pipeline.edges.map((edge) => edge.to));
  const roots = pipeline.pipes.filter((pipe) => !inbound.has(pipe.id));
  const unrunnable = roots.filter(
    (pipe) => pipe.role !== 'source' && pipe.role !== 'trigger',
  );
  if (unrunnable.length > 0) {
    throw new Error(
      `pipeline ${pipeline.id}: every pipeline root must be a source or trigger, but ` +
        `${unrunnable.map((pipe) => `${pipe.id} (${pipe.role})`).join(', ')} ` +
        'has no inbound edge',
    );
  }
}
