/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The run list is read by the scheduler on every dispatch and polled by the
 * designer, so it filters and caps in SQL rather than returning history.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorkflowDef, WorkflowRunRecord } from '../common/index.js';
import { openSqliteStores } from './index.js';

const snapshot = { id: 'wf', version: 1, pipelines: [], triggers: [] } as unknown as WorkflowDef;

function run(id: string, workflowId: string, status: WorkflowRunRecord['status'], minute: number): WorkflowRunRecord {
  return {
    id,
    workflowId,
    workflowVersion: 1,
    status,
    trigger: 'manual',
    triggerId: 'manual',
    startedAt: `2026-09-14T10:${String(minute).padStart(2, '0')}:00.000Z`,
    instanceId: 'test',
  };
}

async function seeded() {
  const stores = openSqliteStores(':memory:', randomBytes(32));
  for (const record of [
    run('a1', 'a', 'succeeded', 1),
    run('a2', 'a', 'queued', 2),
    run('b1', 'b', 'running', 3),
    run('a3', 'a', 'queued', 4),
    run('b2', 'b', 'failed', 5),
  ]) {
    await stores.runs.create(record, { ...snapshot, id: record.workflowId });
  }
  return stores;
}

describe('RunStore.list', () => {
  it('lists newest first, capped by limit', async () => {
    const stores = await seeded();
    expect((await stores.runs.list()).map((r) => r.id)).toEqual(['b2', 'a3', 'b1', 'a2', 'a1']);
    expect((await stores.runs.list(undefined, { limit: 2 })).map((r) => r.id)).toEqual(['b2', 'a3']);
    stores.close();
  });

  it('narrows by workflow and by status together', async () => {
    const stores = await seeded();
    expect((await stores.runs.list('a', { status: ['queued'] })).map((r) => r.id)).toEqual(['a3', 'a2']);
    expect((await stores.runs.list(undefined, { status: ['queued', 'running'] })).map((r) => r.id)).toEqual([
      'a3',
      'b1',
      'a2',
    ]);
    expect(await stores.runs.list('b', { status: ['queued'] })).toEqual([]);
    stores.close();
  });

  it('reads the same statement again after the cache has it', async () => {
    const stores = await seeded();
    const first = await stores.runs.list('a', { status: ['queued'] });
    await stores.runs.create(run('a4', 'a', 'queued', 6), { ...snapshot, id: 'a' });
    const second = await stores.runs.list('a', { status: ['queued'] });
    expect(second.map((r) => r.id)).toEqual(['a4', ...first.map((r) => r.id)]);
    stores.close();
  });
});
