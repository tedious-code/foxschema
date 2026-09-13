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
import { getApiBase, parseJsonResponse } from '@/shared/api/apiBase';
import type { MockEngineConfig } from '../lib/mockWorkflow';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return parseJsonResponse<T>(res);
}

export async function fetchWorkflowSettings(): Promise<WorkflowEngineConfig> {
  const { config } = await request<{ config: WorkflowEngineConfig }>('/workflow/settings');
  return config;
}

export async function saveWorkflowSettings(
  body: AdminConfigPut,
): Promise<WorkflowEngineConfig> {
  const { config } = await request<{ config: WorkflowEngineConfig }>('/workflow/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return config;
}

export async function fetchWorkflowEngineHealth(): Promise<
  WorkflowHealth & { endpoint: string; error?: string }
> {
  return request('/workflow/engine/health');
}

/** Merge persisted control-plane config into the Designer mock engine shape. */
export function toMockEngineConfig(
  config: WorkflowEngineConfig,
  fallback: MockEngineConfig,
): MockEngineConfig {
  return {
    ...fallback,
    state: config.state,
    endpoint: config.endpoint,
    maxParallel: config.maxParallel,
    onOverlap: config.onOverlap,
    sinks: config.sinks.map((s) => ({
      kind: s.kind,
      enabled: s.enabled,
      target: s.target ?? '',
    })),
    processes:
      config.processes.length > 0
        ? config.processes.map((p) => ({
            id: (p.id as MockEngineConfig['processes'][number]['id']) || 'api',
            label: p.label,
            status: p.status === 'down' ? 'down' : 'up',
            detail: p.detail ?? '',
          }))
        : fallback.processes,
  };
}

export function toAdminConfigPut(config: MockEngineConfig): AdminConfigPut {
  return {
    state: config.state,
    acceptsRuns: config.state === 'enabled',
    maxParallel: config.maxParallel,
    onOverlap: config.onOverlap,
    sinks: config.sinks.map((s) => ({
      kind: s.kind,
      enabled: s.enabled,
      target: s.target || undefined,
    })),
  };
}
