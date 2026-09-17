/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — pipe identity and port labels (from FoxAgent lib/ports
 * + lib/pipe-key).
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

/**
 * Friendlier labels for well-known port names, shared by the canvas node
 * handles and the inspector's port chips.
 *
 * Edge pills (`PipeEdge`) keep their own, narrower map on purpose: they relabel
 * only the branch ports and show any other port name as written.
 */
const PORT_LABEL: Record<string, string> = {
  true: 'Yes',
  false: 'No',
  rejects: 'Rejects',
  out: 'Out',
  in: 'In',
};

export function portLabel(name: string): string {
  return PORT_LABEL[name] ?? name;
}
