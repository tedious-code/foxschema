/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-memory engine config and health for the foxworkflow scaffold.
 */
import {
  COMMUNITY_WORKSPACE_ID,
  type AdminConfigPut,
  type EngineState,
  type WorkflowEngineConfig,
  type WorkflowHealth,
} from '@foxschema/workflow-contract';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8081';

export function defaultConfig(): WorkflowEngineConfig {
  return {
    state: 'enabled',
    endpoint: DEFAULT_ENDPOINT,
    maxParallel: 4,
    onOverlap: 'skip',
    processes: [],
    sinks: [
      { kind: 'events', enabled: false },
      { kind: 'json', enabled: false },
      { kind: 'text', enabled: false },
    ],
    workspaceId: COMMUNITY_WORKSPACE_ID,
  };
}

export class EngineStore {
  private config: WorkflowEngineConfig = defaultConfig();

  getConfig(): WorkflowEngineConfig {
    return structuredClone(this.config);
  }

  getHealth(version?: string): WorkflowHealth {
    return {
      ok: true,
      acceptsRuns: this.config.state === 'enabled',
      version,
    };
  }

  applyAdminPut(body: AdminConfigPut): WorkflowEngineConfig {
    if (typeof body.acceptsRuns === 'boolean') {
      this.config.state = body.acceptsRuns ? 'enabled' : 'disabled';
    }
    if (body.state) {
      this.config.state = body.state as EngineState;
    }
    if (typeof body.maxParallel === 'number' && Number.isFinite(body.maxParallel)) {
      this.config.maxParallel = Math.max(1, Math.floor(body.maxParallel));
    }
    if (body.onOverlap) {
      this.config.onOverlap = body.onOverlap;
    }
    if (Array.isArray(body.sinks)) {
      this.config.sinks = body.sinks.map((s) => ({
        kind: s.kind,
        enabled: Boolean(s.enabled),
        target: s.target,
      }));
    }
    return this.getConfig();
  }
}
