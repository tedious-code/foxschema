/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/poll-cursor.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openSqliteStores } from './index.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function database(): Promise<{ filename: string; key: Buffer }> {
  const directory = await mkdtemp(join(tmpdir(), 'foxflow-poll-'));
  cleanup.push(directory);
  return { filename: join(directory, 'foxflow.sqlite'), key: randomBytes(32) };
}

describe('poll cursor storage', () => {
  it('round-trips seen keys across a restart', async () => {
    const { filename, key } = await database();
    const first = openSqliteStores(filename, key);
    await first.schedules.put({
      workflowId: 'wf',
      triggerId: 'tickets',
      nextFireAt: '2026-07-14T00:00:00.000Z',
      seenKeys: ['a', 'b', 'c'],
    });
    first.close();

    const second = openSqliteStores(filename, key);
    expect(await second.schedules.get('wf', 'tickets')).toMatchObject({
      seenKeys: ['a', 'b', 'c'],
    });
    second.close();
  });

  it('distinguishes never-polled from polled-and-saw-nothing', async () => {
    const { filename, key } = await database();
    const stores = openSqliteStores(filename, key);

    // No cursor at all: onFirstPoll decides what happens.
    await stores.schedules.put({
      workflowId: 'wf',
      triggerId: 'fresh',
      nextFireAt: '2026-07-14T00:00:00.000Z',
    });
    // Polled, endpoint was empty: the trigger is primed, not new.
    await stores.schedules.put({
      workflowId: 'wf',
      triggerId: 'primed',
      nextFireAt: '2026-07-14T00:00:00.000Z',
      seenKeys: [],
    });

    expect((await stores.schedules.get('wf', 'fresh'))?.seenKeys).toBeUndefined();
    expect((await stores.schedules.get('wf', 'primed'))?.seenKeys).toEqual([]);
    stores.close();
  });

  it('migrates a database written before the cursor column existed', async () => {
    const { filename, key } = await database();
    const before = openSqliteStores(filename, key);
    await before.schedules.put({
      workflowId: 'wf',
      triggerId: 'nightly',
      nextFireAt: '2026-07-14T00:00:00.000Z',
      scheduleFingerprint: 'abc',
    });
    before.close();

    // Simulate the pre-migration shape: drop the column's data and the
    // migration record, then reopen.
    const legacy = new DatabaseSync(filename);
    legacy.prepare('UPDATE trigger_schedules SET seen_keys_json = NULL').run();
    legacy.close();

    const after = openSqliteStores(filename, key);
    expect(await after.schedules.get('wf', 'nightly')).toMatchObject({
      nextFireAt: '2026-07-14T00:00:00.000Z',
      scheduleFingerprint: 'abc',
    });
    expect((await after.schedules.get('wf', 'nightly'))?.seenKeys).toBeUndefined();
    after.close();
  });

  it('treats a corrupt cursor as never-polled rather than wedging', async () => {
    const { filename, key } = await database();
    const stores = openSqliteStores(filename, key);
    await stores.schedules.put({
      workflowId: 'wf',
      triggerId: 'tickets',
      nextFireAt: '2026-07-14T00:00:00.000Z',
      seenKeys: ['a'],
    });
    stores.close();

    const corrupt = new DatabaseSync(filename);
    corrupt
      .prepare('UPDATE trigger_schedules SET seen_keys_json = ?')
      .run('{not json');
    corrupt.close();

    const reopened = openSqliteStores(filename, key);
    // Re-delivering one batch beats a trigger that throws on every tick.
    expect((await reopened.schedules.get('wf', 'tickets'))?.seenKeys).toBeUndefined();
    reopened.close();
  });
});
