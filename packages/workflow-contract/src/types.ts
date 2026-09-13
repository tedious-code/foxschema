/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wire types for the FoxWorkflow control plane. Keep this package free of Node
 * built-ins — the web app imports it.
 */

/** Whether the engine accepts new runs. */
export type EngineState = 'enabled' | 'draining' | 'disabled';

/** What to do when a process is already running. */
export type OverlapPolicy = 'skip' | 'queue' | 'parallel';

/** How the engine writes operational logs. */
export type LogSinkKind = 'events' | 'json' | 'text';

export interface WorkflowProcessStatus {
  id: string;
  label: string;
  status: string;
  detail?: string;
}

export interface WorkflowLogSink {
  kind: LogSinkKind;
  enabled: boolean;
  target?: string;
}

export interface WorkflowEngineConfig {
  state: EngineState;
  endpoint: string;
  maxParallel: number;
  onOverlap: OverlapPolicy;
  processes: WorkflowProcessStatus[];
  sinks: WorkflowLogSink[];
  workspaceId?: string;
}

export interface WorkflowHealth {
  ok: boolean;
  acceptsRuns: boolean;
  version?: string;
}

/** Body for PUT /v1/admin/config (and the FoxSchema proxy). */
export interface AdminConfigPut {
  acceptsRuns?: boolean;
  state?: EngineState;
  maxParallel?: number;
  onOverlap?: OverlapPolicy;
  sinks?: WorkflowLogSink[];
}
