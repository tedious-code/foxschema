/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/legacy-webhook-shape.test.ts).
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

/**
 * A workflow document exactly as it was written before webhooks grew an `auth`
 * union: signature settings flat on the trigger, no `methods`, no
 * `onMissingIdempotencyKey`.
 */
const legacyDocument = {
  id: 'inbound',
  name: 'inbound',
  version: 1,
  origin: 'authored',
  pipelines: [
    {
      id: 'receive',
      name: 'receive',
      pipes: [
        {
          id: 'payload',
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
  triggers: [
    {
      id: 'hook',
      kind: 'webhook',
      enabled: true,
      credentialId: 'hook-secret',
      signatureHeader: 'x-foxflow-signature',
      timestampHeader: 'x-foxflow-timestamp',
      idempotencyHeader: 'x-idempotency-key',
      maxAgeSeconds: 300,
      maxBodyBytes: 1_048_576,
    },
  ],
  onOverlap: 'skip',
};

async function withLegacyRow(): Promise<ReturnType<typeof openSqliteStores>> {
  const directory = await mkdtemp(join(tmpdir(), 'foxflow-legacy-'));
  cleanup.push(directory);
  const filename = join(directory, 'foxflow.sqlite');
  const key = randomBytes(32);

  // Open once so the migrations run, then write the row the way the old
  // version would have — bypassing the store, which is the point: nothing
  // re-validates a row on the way back out.
  openSqliteStores(filename, key).close();
  const raw = new DatabaseSync(filename);
  raw
    .prepare(
      `INSERT INTO workflows(id, version, definition_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      'inbound',
      1,
      JSON.stringify(legacyDocument),
      new Date().toISOString(),
    );
  raw.close();

  return openSqliteStores(filename, key);
}

describe('webhooks stored before the auth union existed', () => {
  it('reads back in the current shape, defaults included', async () => {
    const stores = await withLegacyRow();
    const workflow = await stores.workflows.get('inbound');
    const trigger = workflow?.triggers[0];

    expect(trigger).toMatchObject({
      id: 'hook',
      kind: 'webhook',
      auth: {
        type: 'signature',
        credentialId: 'hook-secret',
        signatureHeader: 'x-foxflow-signature',
        timestampHeader: 'x-foxflow-timestamp',
        maxAgeSeconds: 300,
      },
      // The regression: the lift restored the shape but not these, so the
      // router read `undefined.includes(method)` and returned a 500.
      methods: ['POST'],
      onMissingIdempotencyKey: 'reject',
    });
    // The keys that moved must not also linger at the top level.
    expect(trigger).not.toHaveProperty('credentialId');
    expect(trigger).not.toHaveProperty('signatureHeader');
    // The keys that stayed put must still be there.
    expect(trigger).toMatchObject({
      idempotencyHeader: 'x-idempotency-key',
      maxBodyBytes: 1_048_576,
    });
    stores.close();
  });

  it('lifts the same way through list() as through get()', async () => {
    const stores = await withLegacyRow();
    const [fromList] = await stores.workflows.list();
    const fromGet = await stores.workflows.get('inbound');
    // The poll and cron coordinators read through list(); the router reads
    // through get(). They must not disagree about a trigger's shape.
    expect(fromList).toEqual(fromGet);
    stores.close();
  });

  it('leaves an already-current document untouched', async () => {
    const stores = await withLegacyRow();
    const lifted = await stores.workflows.get('inbound');
    await stores.workflows.put(lifted!);
    expect(await stores.workflows.get('inbound')).toEqual(lifted);
    stores.close();
  });
});
