/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/scheduler/cron.test.ts).
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSqliteStores } from '../../storage/index.js';
import { CronCoordinator } from './cron.js';

function fingerprint(trigger: {
  cron: string;
  timezone: string;
  executionType: string;
  http?: unknown;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        cron: trigger.cron,
        timezone: trigger.timezone,
        executionType: trigger.executionType,
        http: trigger.http ?? null,
      }),
    )
    .digest('hex');
}

describe('CronCoordinator', () => {
  it('accepts one missed occurrence and does not fire it twice', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const cronTrigger = {
      id: 'every-minute',
      kind: 'cron' as const,
      enabled: true,
      cron: '* * * * *',
      timezone: 'UTC',
      catchUp: 'one' as const,
      executionType: 'workflow' as const,
    };
    await stores.workflows.put({
      id: 'scheduled',
      name: 'scheduled',
      version: 1,
      pipelines: [
        {
          id: 'load',
          name: 'load',
          pipes: [
            {
              id: 'source',
              role: 'source',
              type: 'source.triggerPayload',
              config: {},
              concurrency: 1,
            },
          ],
          edges: [],
        },
      ],
      dependencies: [],
      middleware: [],
      triggers: [cronTrigger],
      onOverlap: 'parallel',
      origin: 'authored',
    });
    await stores.schedules.put({
      workflowId: 'scheduled',
      triggerId: 'every-minute',
      nextFireAt: '2026-07-14T10:04:00.000Z',
      scheduleFingerprint: fingerprint(cronTrigger),
    });
    const invocations: unknown[] = [];
    const coordinator = new CronCoordinator({
      workflows: stores.workflows,
      schedules: stores.schedules,
      scheduler: {
        async enqueue(_workflow, invocation) {
          invocations.push(invocation);
        },
      },
      now: () => new Date('2026-07-14T10:05:30.000Z'),
    });

    await coordinator.recover();
    await coordinator.recover();

    expect(invocations).toEqual([
      expect.objectContaining({
        workflowId: 'scheduled',
        triggerId: 'every-minute',
        kind: 'cron',
        idempotencyKey: 'cron:2026-07-14T10:04:00.000Z',
        payload: { scheduledAt: '2026-07-14T10:04:00.000Z' },
      }),
    ]);
    expect(await stores.schedules.get('scheduled', 'every-minute')).toMatchObject({
      workflowId: 'scheduled',
      triggerId: 'every-minute',
      nextFireAt: '2026-07-14T10:06:00.000Z',
      lastAcceptedAt: '2026-07-14T10:04:00.000Z',
      scheduleFingerprint: expect.any(String),
    });

    const workflow = await stores.workflows.get('scheduled');
    if (!workflow) throw new Error('test workflow missing');
    await stores.workflows.put({
      ...workflow,
      triggers: workflow.triggers.map((trigger) =>
        trigger.kind === 'cron' ? { ...trigger, cron: '0 * * * *' } : trigger,
      ),
    });
    await coordinator.recover();
    expect(await stores.schedules.get('scheduled', 'every-minute')).toMatchObject({
      nextFireAt: '2026-07-14T11:00:00.000Z',
      lastAcceptedAt: undefined,
    });
    expect(invocations).toHaveLength(1);

    await stores.schedules.put({
      workflowId: 'scheduled',
      triggerId: 'every-minute',
      nextFireAt: '2026-07-14T10:04:00.000Z',
    });
    await coordinator.recover();
    expect(await stores.schedules.get('scheduled', 'every-minute')).toMatchObject({
      nextFireAt: '2026-07-14T11:00:00.000Z',
      lastAcceptedAt: undefined,
      scheduleFingerprint: expect.any(String),
    });
    expect(invocations).toHaveLength(1);
    stores.close();
  });

  it('fires executionType http with the shared request config (no workflow enqueue)', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const http = {
      url: 'https://hooks.example.com/tick',
      method: 'POST' as const,
      query: [{ key: 'source', value: 'cron', enabled: true }],
      headers: [{ key: 'x-test', value: '1', enabled: true }],
      auth: { type: 'none' as const },
      body: { mode: 'json' as const, json: { ping: true } },
      timeoutMs: 5_000,
      variables: {},
      session: { enabled: false, persistToCredential: true },
    };
    const cronTrigger = {
      id: 'http-job',
      kind: 'cron' as const,
      enabled: true,
      cron: '* * * * *',
      timezone: 'UTC',
      catchUp: 'one' as const,
      executionType: 'http' as const,
      http,
    };
    await stores.workflows.put({
      id: 'http-scheduled',
      name: 'http-scheduled',
      version: 1,
      pipelines: [
        {
          id: 'noop',
          name: 'noop',
          pipes: [
            {
              id: 'source',
              role: 'source',
              type: 'source.triggerPayload',
              config: {},
              concurrency: 1,
            },
          ],
          edges: [],
        },
      ],
      dependencies: [],
      middleware: [],
      triggers: [cronTrigger],
      onOverlap: 'skip',
      origin: 'authored',
    });
    await stores.schedules.put({
      workflowId: 'http-scheduled',
      triggerId: 'http-job',
      nextFireAt: '2026-07-14T10:04:00.000Z',
      scheduleFingerprint: fingerprint(cronTrigger),
    });

    const enqueued: unknown[] = [];
    const fetches: string[] = [];
    const coordinator = new CronCoordinator({
      workflows: stores.workflows,
      schedules: stores.schedules,
      scheduler: {
        async enqueue(_workflow, invocation) {
          enqueued.push(invocation);
        },
      },
      fetch: async (url) => {
        fetches.push(String(url));
        return new Response('ok', { status: 200 });
      },
      now: () => new Date('2026-07-14T10:05:30.000Z'),
    });

    await coordinator.recover();
    // HTTP fires are detached from the scheduling tick — drain the microtask
    // chain before asserting the call happened.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(enqueued).toHaveLength(0);
    expect(fetches).toEqual([
      'https://hooks.example.com/tick?source=cron',
    ]);
    stores.close();
  });
});

