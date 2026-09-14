/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (lib/pipe-key.ts).
 */
/**
 * Identity of a pipe across the whole workflow.
 *
 * Pipe ids are only unique within a pipeline, so anything keyed by pipe —
 * canvas node ids, live run state, debug errors — has to carry the pipeline
 * too. Built in one place so the separator cannot drift between the canvas and
 * the maps the run events fill.
 */
export function pipeKey(pipelineId: string, pipeId: string): string {
  return `${pipelineId}::${pipeId}`;
}
