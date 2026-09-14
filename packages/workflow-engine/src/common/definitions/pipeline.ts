/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/definitions/pipeline.ts).
 */
import { z } from 'zod';
import { edgeSchema, pipeSchema } from './pipe.js';

// A pipeline is the unit of streaming in the workflow > pipeline > pipe
// hierarchy: one connected DAG of pipes through which batches flow with
// backpressure, contracts on every edge, and no barriers. Orchestration
// concerns (triggers, overlap policy, completion ordering, gates) live one
// level up on the workflow.
export const pipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  /**
   * What this streaming DAG accomplishes (Agentic OS). One task per pipeline.
   */
  task: z.string().max(2000).optional(),
  pipes: z.array(pipeSchema).min(1),
  edges: z.array(edgeSchema).default([]),
});
export type PipelineDef = z.infer<typeof pipelineSchema>;

/**
 * Graph-integrity checks shared by parsePipeline and parseWorkflow: unique
 * pipe ids and edges that reference real pipes. (Cycle detection happens in
 * planExecution, which walks the graph anyway.)
 */
export function assertPipelineGraph(pipeline: PipelineDef): void {
  const ids = new Set<string>();
  for (const pipe of pipeline.pipes) {
    if (ids.has(pipe.id)) {
      throw new Error(`pipeline ${pipeline.id}: duplicate pipe id: ${pipe.id}`);
    }
    ids.add(pipe.id);
  }
  for (const edge of pipeline.edges) {
    if (!ids.has(edge.from)) {
      throw new Error(
        `pipeline ${pipeline.id}: edge references unknown source pipe: ${edge.from}`,
      );
    }
    if (!ids.has(edge.to)) {
      throw new Error(
        `pipeline ${pipeline.id}: edge references unknown target pipe: ${edge.to}`,
      );
    }
  }
}

/**
 * Parse and structurally validate a standalone pipeline definition. Throws a
 * ZodError on shape problems and a plain Error on graph problems.
 */
export function parsePipeline(input: unknown): PipelineDef {
  const pipeline = pipelineSchema.parse(input);
  assertPipelineGraph(pipeline);
  return pipeline;
}
