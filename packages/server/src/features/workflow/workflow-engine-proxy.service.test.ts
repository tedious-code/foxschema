/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The proxy authenticates to the engine with FoxSchema's own service token.
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowEngineConfig } from '@foxschema/workflow-contract';
import { WorkflowEngineProxyService } from './workflow-engine-proxy.service';

const settings = {
  getConfig: async (): Promise<WorkflowEngineConfig> => ({
    state: 'enabled',
    endpoint: 'http://engine.test:8081',
    maxParallel: 4,
    onOverlap: 'skip',
    processes: [],
    sinks: [],
  }),
};

async function authorizationSent(token: string | undefined): Promise<string | null> {
  let sent: Headers | undefined;
  const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    sent = new Headers(init.headers);
    return Response.json([]);
  }) as typeof fetch;
  await new WorkflowEngineProxyService(settings, fetchImpl, token).forward({
    method: 'GET',
    path: '/workflows',
    search: '',
  });
  return sent!.get('authorization');
}

describe('WorkflowEngineProxyService service token', () => {
  it('presents the token when one is configured', async () => {
    expect(await authorizationSent('shared-token')).toBe('Bearer shared-token');
  });

  it('sends no authorization at all without one', async () => {
    expect(await authorizationSent(undefined)).toBeNull();
  });
});
