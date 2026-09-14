/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/goto/index.ts).
 */
/**
 * Deliberately NOT wrapped as a pipe (unlike merge/split/loop): nothing in the
 * runtime consumes `GotoDirective` yet, and a config-driven jump target would
 * need output ports that `assertKnownFromPorts` can't see in static metadata.
 * A Goto node ships only together with engine batch-router support.
 */
export interface GotoDirective {
  /** Target pipe id within the current compiled pipeline. */
  target: string;
  /** Optional output port presented to the batch router. */
  port?: string;
}

export function goto(target: string, port?: string): GotoDirective {
  if (!target.trim()) throw new Error('goto target is required');
  return { target, ...(port ? { port } : {}) };
}
