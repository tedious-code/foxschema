/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/multi-instance-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, PipeRegistry, parseWorkflowInput } from '../index.js';
import {
  ManualTriggerSourcePipe,
  TriggerPayloadSourcePipe,
} from '../pipes/trigger/index.js';
import { MapPipe } from '../pipes/utility/index.js';

/**
 * Two engine instances sharing one database — the shape of a two-machine
 * deployment, and the first place single-instance assumptions break.
 *
 * `onOverlap: 'skip'` used to be decided by listing active runs and then
 * inserting. Within one process an in-memory admission map serialised that;
 * across two, both instances read "none active" and both inserted, so a
 * workflow that must not overlap ran twice. For a nightly migration or a
 * billing job that is duplicated writes, not a slow build.
 */

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function workflowDoc(overlap: 'skip' | 'queue' | 'parallel') {
  return parseWorkflowInput({
    id: 'shared',
    name: 'Shared',
    onOverlap: overlap,
    triggers: [{ id: 'm', kind: 'manual', enabled: true }],
    pipelines: [
      {
        id: 'p',
        name: 'P',
        pipes: [
          { id: 'src', type: 'source.triggerPayload', role: 'source', config: {} },
          {
            id: 'map',
            type: 'transform.map',
            role: 'transform',
            config: { mappings: { a: 'a' } },
          },
        ],
        edges: [{ from: 'src', to: 'map' }],
      },
    ],
  });
}

function engineAt(databasePath: string, encryptionKey: Buffer, instanceId: string) {
  return new Engine({
    databasePath,
    encryptionKey,
    instanceId,
    registry: new PipeRegistry([
      new TriggerPayloadSourcePipe(),
      new ManualTriggerSourcePipe(),
      new MapPipe(),
    ]),
  });
}

async function sharedPair() {
  const dir = await mkdtemp(join(tmpdir(), 'foxflow-multi-'));
  cleanup.push(dir);
  const databasePath = join(dir, 'shared.sqlite');
  const key = randomBytes(32);
  return {
    a: engineAt(databasePath, key, 'instance-a'),
    b: engineAt(databasePath, key, 'instance-b'),
  };
}

const invocation = (id: string) =>
  ({
    id,
    workflowId: 'shared',
    triggerId: 'm',
    kind: 'manual',
    acceptedAt: new Date().toISOString(),
  }) as never;

describe('two instances, one database', () => {
  it('admits a skip workflow exactly once when both instances race', async () => {
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('skip');
      await a.stores.workflows.put(workflow as never);

      const [first, second] = await Promise.all([
        a.scheduler.enqueue(workflow as never, invocation('a1')),
        b.scheduler.enqueue(workflow as never, invocation('b1')),
      ]);
      await a.idle();
      await b.idle();

      // Exactly one winner, and the loser is told why rather than failing.
      expect([first.accepted, second.accepted].filter(Boolean)).toHaveLength(1);
      const loser = first.accepted ? second : first;
      expect(loser.reason).toBe('overlap');

      const runs = await a.stores.runs.list('shared');
      expect(runs).toHaveLength(1);
      expect(runs[0]!.status).toBe('succeeded');
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('still lets both through when the policy is parallel', async () => {
    // The guard must enforce the declared policy, not blanket-serialise: a
    // workflow that opted into overlapping runs still gets them.
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('parallel');
      await a.stores.workflows.put(workflow as never);

      const [first, second] = await Promise.all([
        a.scheduler.enqueue(workflow as never, invocation('a2')),
        b.scheduler.enqueue(workflow as never, invocation('b2')),
      ]);
      await a.idle();
      await b.idle();

      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
      expect(await a.stores.runs.list('shared')).toHaveLength(2);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('lets the next run in once the first has finished', async () => {
    // Skip means "not while one is active", not "only ever once".
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('skip');
      await a.stores.workflows.put(workflow as never);

      const first = await a.scheduler.enqueue(workflow as never, invocation('a3'));
      await a.idle();
      const second = await b.scheduler.enqueue(workflow as never, invocation('b3'));
      await b.idle();

      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
      const runs = await a.stores.runs.list('shared');
      expect(runs).toHaveLength(2);
      expect(runs.every((run) => run.status === 'succeeded')).toBe(true);
      // Both instances did work — this is a shared queue, not a hot standby.
      expect(new Set(runs.map((run) => run.instanceId)).size).toBe(2);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('records which instance owns each run', async () => {
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('parallel');
      await a.stores.workflows.put(workflow as never);
      await a.scheduler.enqueue(workflow as never, invocation('a4'));
      await b.scheduler.enqueue(workflow as never, invocation('b4'));
      await a.idle();
      await b.idle();

      const runs = await a.stores.runs.list('shared');
      expect(new Set(runs.map((run) => run.instanceId))).toEqual(
        new Set(['instance-a', 'instance-b']),
      );
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('leaves a live peer\'s run alone when another instance recovers', async () => {
    // The bug this closes: recovery reclaimed every run in `running` state
    // regardless of owner, so a second instance booting beside a working peer
    // re-executed its work.
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('parallel');
      await a.stores.workflows.put(workflow as never);
      const { run } = await a.scheduler.enqueue(workflow as never, invocation('live'));
      // Let it finish first: the point of the test is the stale row it leaves,
      // and a run still executing would be writing while the test closes.
      await a.idle();

      // Stand in for a peer mid-flight: running, with a lease still valid.
      const record = (await a.stores.runs.get(run!.id))!;
      record.status = 'running';
      await a.stores.runs.update(record);
      await a.stores.runs.renewLease!(
        run!.id,
        'instance-a',
        new Date(Date.now() + 60_000).toISOString(),
      );

      const reclaimed = await b.stores.runs.interruptRunning(
        new Date().toISOString(),
      );

      expect(reclaimed.map((entry) => entry.id)).not.toContain(run!.id);
      expect((await b.stores.runs.get(run!.id))?.status).toBe('running');
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('reclaims a run whose owner stopped renewing', async () => {
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('parallel');
      await a.stores.workflows.put(workflow as never);
      const { run } = await a.scheduler.enqueue(workflow as never, invocation('dead'));
      await a.idle();

      const record = (await a.stores.runs.get(run!.id))!;
      record.status = 'running';
      await a.stores.runs.update(record);
      // The lease an instance that died would leave behind: written once, then
      // never renewed because the process holding the timer is gone.
      await a.stores.runs.renewLease!(
        run!.id,
        'instance-a',
        new Date(Date.now() - 1_000).toISOString(),
      );

      const reclaimed = await b.stores.runs.interruptRunning(
        new Date().toISOString(),
      );

      expect(reclaimed.map((entry) => entry.id)).toContain(run!.id);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('reclaims a legacy run that never had a lease', async () => {
    // Rows written before the lease column exists have NULL, and a single
    // instance restarting after a crash must still recover them.
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('parallel');
      await a.stores.workflows.put(workflow as never);
      const run = {
        id: 'legacy-run',
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: 'running',
        trigger: 'manual',
        triggerId: 'm',
        startedAt: new Date().toISOString(),
        instanceId: 'instance-a',
      } as const;
      await a.stores.runs.create(run, workflow as never);

      const reclaimed = await b.stores.runs.interruptRunning(
        new Date().toISOString(),
      );

      expect(reclaimed.map((entry) => entry.id)).toContain(run.id);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('refuses to renew another instance\'s lease', async () => {
    // Renewing a peer's lease would hide a genuinely dead instance.
    const { a, b } = await sharedPair();
    try {
      const workflow = workflowDoc('parallel');
      await a.stores.workflows.put(workflow as never);
      const { run } = await a.scheduler.enqueue(workflow as never, invocation('own'));
      await a.idle();
      const record = (await a.stores.runs.get(run!.id))!;
      record.status = 'running';
      await a.stores.runs.update(record);

      const mine = await a.stores.runs.renewLease!(
        run!.id,
        'instance-a',
        new Date(Date.now() + 60_000).toISOString(),
      );
      const theirs = await b.stores.runs.renewLease!(
        run!.id,
        'instance-b',
        new Date(Date.now() + 60_000).toISOString(),
      );

      expect(mine).toBe(true);
      expect(theirs).toBe(false);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
