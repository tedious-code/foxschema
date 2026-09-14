/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/sqlite.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openSqliteStores } from './index.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('SQLite stores', () => {
  it('migrates idempotently and survives a process restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'foxflow-storage-'));
    cleanup.push(directory);
    const filename = join(directory, 'foxflow.sqlite');
    const key = randomBytes(32);
    const workflow = {
      id: 'orders',
      name: 'orders',
      version: 1,
      pipelines: [
        {
          id: 'load',
          name: 'load',
          pipes: [
            {
              id: 'source',
              role: 'source' as const,
              type: 'source.csv',
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
          id: 'webhook',
          kind: 'webhook' as const,
          enabled: true,
          auth: {
            type: 'signature' as const,
            credentialId: 'hook-secret',
            signatureHeader: 'x-foxflow-signature',
            timestampHeader: 'x-foxflow-timestamp',
            maxAgeSeconds: 300,
          },
          methods: ['POST' as const],
          idempotencyHeader: 'x-idempotency-key',
          onMissingIdempotencyKey: 'reject' as const,
          maxBodyBytes: 1_048_576,
        },
        {
          id: 'nightly',
          kind: 'cron' as const,
          enabled: true,
          cron: '0 0 * * *',
          timezone: 'UTC',
          catchUp: 'none' as const,
          executionType: 'workflow' as const,
        },
      ],
      onOverlap: 'skip' as const,
      origin: 'authored' as const,
    };
    const invocation = {
      id: 'invocation-1',
      workflowId: workflow.id,
      triggerId: 'webhook',
      kind: 'webhook' as const,
      acceptedAt: '2026-07-13T00:00:00.000Z',
      payload: { orderId: 42, note: 'sensitive-payload-marker' },
      idempotencyKey: 'h1:request-42',
      metadata: { contentType: 'application/json' },
    };
    const run = {
      id: 'run-1',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: 'queued' as const,
      trigger: 'webhook',
      triggerId: 'webhook',
      startedAt: '2026-07-13T00:00:00.000Z',
      instanceId: 'local',
    };

    const first = openSqliteStores(filename, key);
    await first.workflows.put(workflow);
    await first.runs.create(run, workflow, invocation);
    await first.events.append({
      workflowRunId: run.id,
      at: run.startedAt,
      type: 'run.status',
      data: { status: 'queued' },
    });
    await first.checkpoints.put({
      workflowRunId: run.id,
      pipelineId: 'load',
      pipeId: 'source',
      partitionId: '0',
      cursor: { row: 12 },
      updatedAt: run.startedAt,
    });
    await first.schedules.put({
      workflowId: workflow.id,
      triggerId: 'nightly',
      nextFireAt: '2026-07-14T00:00:00.000Z',
      lastAcceptedAt: '2026-07-13T00:00:00.000Z',
      scheduleFingerprint: undefined,
    });
    const credential = await first.credentials.create({
      name: 'postgres',
      kind: 'database',
      data: { password: 'not-plaintext' },
    });
    first.close();

    const legacy = new DatabaseSync(filename);
    legacy
      .prepare('UPDATE workflow_runs SET idempotency_key = ? WHERE id = ?')
      .run('h1:request-42', run.id);
    legacy
      .prepare(
        `UPDATE trigger_schedules SET schedule_fingerprint = NULL
         WHERE workflow_id = ? AND trigger_id = ?`,
      )
      .run(workflow.id, 'nightly');
    legacy.prepare('DELETE FROM schema_migrations WHERE version = 5').run();
    legacy.close();

    const second = openSqliteStores(filename, key);
    expect(await second.workflows.get('orders')).toEqual(workflow);
    expect(await second.runs.get(run.id)).toEqual(run);
    expect(await second.runs.getSnapshot(run.id)).toEqual(workflow);
    expect(await second.runs.getInvocation(run.id)).toEqual(invocation);
    expect(await second.events.list(run.id, 0)).toMatchObject([
      { seq: 1, type: 'run.status' },
    ]);
    expect(
      await second.checkpoints.get(run.id, 'load', 'source', '0'),
    ).toMatchObject({ cursor: { row: 12 } });
    expect(await second.schedules.get(workflow.id, 'nightly')).toMatchObject({
      workflowId: workflow.id,
      triggerId: 'nightly',
      nextFireAt: '2026-07-14T00:00:00.000Z',
      lastAcceptedAt: '2026-07-13T00:00:00.000Z',
      scheduleFingerprint: undefined,
    });
    expect(
      await second.runs.findByIdempotencyKey(
        workflow.id,
        invocation.triggerId,
        invocation.idempotencyKey,
      ),
    ).toMatchObject({ id: run.id });
    expect(await second.credentials.revealSecret(credential.id)).toEqual({
      password: 'not-plaintext',
    });
    second.close();

    expect((await readFile(filename)).includes(Buffer.from('not-plaintext'))).toBe(
      false,
    );
    expect(
      (await readFile(filename)).includes(Buffer.from('sensitive-payload-marker')),
    ).toBe(false);
    expect((await readFile(filename)).includes(Buffer.from('h1:request-42'))).toBe(
      false,
    );
  });
});
