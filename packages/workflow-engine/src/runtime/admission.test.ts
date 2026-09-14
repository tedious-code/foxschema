/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The engine settings an admin saves in FoxSchema: whether new runs are taken,
 * and how many execute at once.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorkflowDef } from '../common/index.js';
import { openSqliteStores } from '../storage/index.js';
import { LocalRunScheduler, type WorkflowRunner } from './workflow.js';

const workflow = {
  id: 'wf',
  name: 'wf',
  version: 1,
  onOverlap: 'parallel',
  triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
  pipelines: [],
} as unknown as WorkflowDef;

function harness(maxConcurrentRuns?: number) {
  const stores = openSqliteStores(':memory:', randomBytes(32));
  let active = 0;
  let peak = 0;
  const gates: Array<() => void> = [];
  const runner = {
    async run(runId: string) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      const run = await stores.runs.get(runId);
      await stores.runs.update({ ...run!, status: 'succeeded', finishedAt: new Date().toISOString() });
      active -= 1;
    },
  } as unknown as WorkflowRunner;
  const scheduler = new LocalRunScheduler({
    runs: stores.runs,
    events: stores.events,
    runner,
    ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { stores, scheduler, gates, peak: () => peak, active: () => active, settle };
}

describe('run admission', () => {
  it('executes at most maxConcurrentRuns at once and keeps the rest queued', async () => {
    const h = harness(2);
    for (let i = 0; i < 5; i++) expect((await h.scheduler.enqueue(workflow)).accepted).toBe(true);
    await h.settle();
    expect(h.active()).toBe(2);

    while (h.gates.length > 0) {
      h.gates.shift()!();
      await h.settle();
    }
    await h.scheduler.idle();
    expect(h.peak()).toBe(2);
    expect((await h.stores.runs.list(undefined, { status: ['succeeded'] })).length).toBe(5);
    h.stores.close();
  });

  it('lets waiting runs start when the limit is raised', async () => {
    const h = harness(1);
    for (let i = 0; i < 3; i++) await h.scheduler.enqueue(workflow);
    await h.settle();
    expect(h.active()).toBe(1);

    h.scheduler.setAdmission({ state: 'enabled', maxConcurrentRuns: 3 });
    await h.settle();
    expect(h.active()).toBe(3);

    h.gates.splice(0).forEach((open) => open());
    await h.scheduler.idle();
    h.stores.close();
  });

  it('admits nothing while disabled, and only work for runs in flight while draining', async () => {
    const h = harness();
    h.scheduler.setAdmission({ state: 'disabled' });
    expect(await h.scheduler.enqueue(workflow)).toEqual({
      accepted: false,
      reason: 'disabled',
      detail: 'the workflow engine is disabled',
    });

    h.scheduler.setAdmission({ state: 'draining' });
    expect((await h.scheduler.enqueue(workflow)).reason).toBe('disabled');
    const child = await h.scheduler.enqueue(workflow, undefined, { parentRunId: 'parent-run' });
    expect(child.accepted).toBe(true);

    h.scheduler.setAdmission({ state: 'enabled' });
    expect((await h.scheduler.enqueue(workflow)).accepted).toBe(true);

    await h.settle();
    h.gates.splice(0).forEach((open) => open());
    await h.scheduler.idle();
    expect(await h.stores.runs.list()).toHaveLength(2);
    h.stores.close();
  });
});
