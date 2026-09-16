/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, parseWorkflowInput } from '../index.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'foxflow-queued-claim-'));
  cleanup.push(dir);
  const databasePath = join(dir, 'shared.sqlite');
  const encryptionKey = randomBytes(32);
  return {
    scheduler: new Engine({
      databasePath,
      encryptionKey,
      instanceId: 'scheduler',
      executeInline: false,
    }),
    workerA: new Engine({
      databasePath,
      encryptionKey,
      instanceId: 'worker-a',
    }),
    workerB: new Engine({
      databasePath,
      encryptionKey,
      instanceId: 'worker-b',
    }),
  };
}

const workflow = parseWorkflowInput({
  id: 'claim-race',
  name: 'Claim race',
  onOverlap: 'parallel',
  triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
  pipelines: [
    {
      id: 'pipeline',
      name: 'Pipeline',
      pipes: [
        {
          id: 'source',
          type: 'source.trigger.manual',
          role: 'source',
          config: {},
        },
      ],
      edges: [],
    },
  ],
});

describe('split-role queued-run claims', () => {
  it('allows exactly one worker to execute a scheduler-owned queued run', async () => {
    const { scheduler, workerA, workerB } = await harness();
    try {
      await scheduler.stores.workflows.put(workflow);
      const admitted = await scheduler.scheduler.enqueue(workflow);

      expect(admitted.run).toMatchObject({
        status: 'queued',
        instanceId: 'scheduler',
      });

      await Promise.all([
        workerA.scheduler.dispatchAvailable(),
        workerB.scheduler.dispatchAvailable(),
      ]);
      await Promise.all([workerA.idle(), workerB.idle()]);

      const events = await scheduler.stores.events.list(admitted.run!.id);
      expect(
        events.filter(
          (event) =>
            event.type === 'run.status' && event.data?.status === 'running',
        ),
      ).toHaveLength(1);
      expect(
        (await scheduler.stores.runs.get(admitted.run!.id))?.instanceId,
      ).toMatch(/^worker-[ab]$/);
    } finally {
      await scheduler.close();
      await workerA.close();
      await workerB.close();
    }
  });

  it('transfers ownership and permits lease renewal only for the claim winner', async () => {
    const { scheduler, workerA, workerB } = await harness();
    try {
      await scheduler.stores.workflows.put(workflow);
      const { run } = await scheduler.scheduler.enqueue(workflow);
      const expiresAt = new Date(Date.now() + 60_000).toISOString();

      const claims = await Promise.all([
        workerA.stores.runs.claimQueuedRun(run!.id, 'worker-a', expiresAt),
        workerB.stores.runs.claimQueuedRun(run!.id, 'worker-b', expiresAt),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);

      const winner = claims[0] ? 'worker-a' : 'worker-b';
      const loser = claims[0] ? 'worker-b' : 'worker-a';
      expect(await scheduler.stores.runs.get(run!.id)).toMatchObject({
        status: 'running',
        instanceId: winner,
      });
      expect(
        await scheduler.stores.runs.renewLease!(
          run!.id,
          winner,
          new Date(Date.now() + 120_000).toISOString(),
        ),
      ).toBe(true);
      expect(
        await scheduler.stores.runs.renewLease!(
          run!.id,
          loser,
          new Date(Date.now() + 120_000).toISOString(),
        ),
      ).toBe(false);
    } finally {
      await scheduler.close();
      await workerA.close();
      await workerB.close();
    }
  });
});
