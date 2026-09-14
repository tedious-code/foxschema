/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Control-plane client for FoxWorkflow settings and engine health.
 */
import type {
  AdminConfigPut,
  WorkflowEngineConfig,
  WorkflowHealth,
} from '@foxschema/workflow-contract';
import { api } from '@/shared/api/client';

export async function fetchWorkflowSettings(): Promise<WorkflowEngineConfig> {
  const { config } = await api.get<{ config: WorkflowEngineConfig }>('/workflow/settings');
  return config;
}

export async function saveWorkflowSettings(body: AdminConfigPut): Promise<WorkflowEngineConfig> {
  const { config } = await api.put<{ config: WorkflowEngineConfig }>('/workflow/settings', body);
  return config;
}

export async function fetchWorkflowEngineHealth(): Promise<
  WorkflowHealth & { endpoint: string; error?: string }
> {
  return api.get('/workflow/engine/health');
}

/** The editable part of the engine config, as the settings endpoint takes it. */
export function toAdminConfigPut(config: WorkflowEngineConfig): AdminConfigPut {
  return {
    state: config.state,
    acceptsRuns: config.state === 'enabled',
    endpoint: config.endpoint,
    maxParallel: config.maxParallel,
    onOverlap: config.onOverlap,
    sinks: config.sinks.map((s) => ({
      kind: s.kind,
      enabled: s.enabled,
      target: s.target || undefined,
    })),
  };
}
