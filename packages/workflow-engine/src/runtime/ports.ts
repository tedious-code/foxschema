/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/ports.ts).
 */
import type { EdgeDef, PipeDef } from '../common/index.js';
import type { PipeRegistry, RecordBatch } from '../registry/index.js';

/** Transform output: a single batch, several batches, or batches keyed by port. */
export type TransformOutput =
  | RecordBatch
  | RecordBatch[]
  | Map<string, RecordBatch>
  | undefined;

export interface PortedBatch {
  port: string;
  batch: RecordBatch;
}

function declaredOutputs(
  registry: PipeRegistry,
  pipe: PipeDef,
): { name: string }[] | undefined {
  try {
    return registry.metadata(pipe.type).outputs;
  } catch {
    return undefined;
  }
}

/**
 * Default output port for unlabeled edges: prefer `out`, else the first
 * declared output, else `out` when metadata is unavailable.
 */
export function defaultOutputPort(
  registry: PipeRegistry,
  pipe: PipeDef,
): string {
  const outputs = declaredOutputs(registry, pipe);
  if (!outputs?.length) return 'out';
  return outputs.find((port) => port.name === 'out')?.name ?? outputs[0]!.name;
}

export function outputPortNames(
  registry: PipeRegistry,
  pipe: PipeDef,
): string[] | undefined {
  return declaredOutputs(registry, pipe)?.map((port) => port.name);
}

/** Expand transform results into port-tagged batches. */
export function normalizePortedBatches(
  output: TransformOutput,
  defaultPort: string,
): PortedBatch[] {
  if (!output) return [];
  if (output instanceof Map) {
    return [...output.entries()].map(([port, batch]) => ({ port, batch }));
  }
  const batches = Array.isArray(output) ? output : [output];
  return batches.map((batch) => ({
    port: batch.port ?? defaultPort,
    batch,
  }));
}

/** Whether a streaming edge should receive a batch emitted on `port`. */
export function edgeMatchesPort(
  edge: EdgeDef,
  port: string,
  defaultPort: string,
): boolean {
  return (edge.fromPort ?? defaultPort) === port;
}

/**
 * Reject edges whose `fromPort` is not declared on the source pipe metadata.
 * Pipes without metadata skip the check (test doubles).
 */
export function assertKnownFromPorts(
  registry: PipeRegistry,
  pipes: Map<string, PipeDef>,
  edges: EdgeDef[],
): void {
  for (const edge of edges) {
    if (!edge.fromPort) continue;
    const source = pipes.get(edge.from);
    if (!source) continue;
    const ports = outputPortNames(registry, source);
    if (!ports) continue;
    if (!ports.includes(edge.fromPort)) {
      throw new Error(
        `edge ${edge.from} → ${edge.to}: unknown fromPort "${edge.fromPort}" `
          + `(declared: ${ports.join(', ') || 'none'})`,
      );
    }
  }
}
