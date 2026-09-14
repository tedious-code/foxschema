/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/input-schema.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LocalRunScheduler,
  WorkflowRunner,
  parseWorkflow,
} from '../index.js';
import { openSqliteStores } from './index.js';

function runtime(stores: ReturnType<typeof openSqliteStores>) {
  const runner = new WorkflowRunner({
    runs: stores.runs,
    events: stores.events,
    pipelineExecutor: { async execute() {} },
  });
  return new LocalRunScheduler({
    runs: stores.runs,
    events: stores.events,
    runner,
    instanceId: 'input-schema-test',
  });
}

const guarded = parseWorkflow({
  id: 'guarded',
  name: 'guarded',
  inputSchema: {
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      required: ['sku'],
      properties: { sku: { type: 'string' } },
    },
  },
  pipelines: [
    {
      id: 'main',
      name: 'main',
      pipes: [
        { id: 'src', role: 'source', type: 'source.triggerPayload', config: {} },
      ],
      edges: [],
    },
  ],
});

function manualInvocation(payload: unknown) {
  return {
    id: crypto.randomUUID(),
    workflowId: 'guarded',
    triggerId: 'manual',
    kind: 'manual' as const,
    acceptedAt: new Date().toISOString(),
    payload,
    metadata: {},
  };
}

describe('workflow inputSchema enforcement at admission', () => {
  it('accepts a payload matching the schema', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = runtime(stores);
    const result = await scheduler.enqueue(
      guarded,
      manualInvocation([{ sku: 'A-1' }]),
    );
    expect(result.accepted).toBe(true);
    await scheduler.idle();
    expect(await stores.runs.get(result.run!.id)).toMatchObject({
      status: 'succeeded',
    });
    stores.close();
  });

  it('rejects a payload violating the schema with WorkflowInputError', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = runtime(stores);
    const failure = scheduler.enqueue(
      guarded,
      manualInvocation({ not: 'an array' }),
    );
    await expect(failure).rejects.toMatchObject({
      name: 'WorkflowInputError',
      message: expect.stringContaining('workflow guarded input invalid'),
    });
    // Nothing was admitted.
    expect(await stores.runs.list('guarded')).toHaveLength(0);
    stores.close();
  });

  it('rejects a missing payload when the schema requires one', async () => {
    const stores = openSqliteStores(':memory:', randomBytes(32));
    const scheduler = runtime(stores);
    // No invocation → scheduler builds the manual one; the trigger has no
    // inputData, so the payload is undefined and fails the array schema.
    await expect(scheduler.enqueue(guarded)).rejects.toMatchObject({
      name: 'WorkflowInputError',
    });
    stores.close();
  });
});
