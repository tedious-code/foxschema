/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/cron-http-map-e2e.test.ts).
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConditionPipe,
  CronCoordinator,
  CronTriggerSourcePipe,
  Engine,
  HttpSourcePipe,
  MapPipe,
  PipeRegistry,
  PostgresSinkPipe,
  parseWorkflow,
  type PostgresClient,
} from '../index.js';

/**
 * Schedule (cron) → workflow run → HTTP fetch → map → PostgreSQL insert.
 * Stitches pieces that were only covered in isolation before.
 */

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

/** Hermetic sink: claims batch ids and records inserted row tuples. */
class FakePostgres {
  readonly committed = new Set<string>();
  readonly inserted: Record<string, unknown>[] = [];

  get insertedRows(): number {
    return this.inserted.length;
  }

  client(): PostgresClient {
    return {
      async connect() {},
      async end() {},
      query: async (text, values) => {
        if (
          text.includes('_foxflow_committed_batches') &&
          text.includes('INSERT')
        ) {
          const key = `${String(values?.[1])}/${String(values?.[0])}`;
          if (this.committed.has(key)) return { rowCount: 0, rows: [] };
          this.committed.add(key);
          return { rowCount: 1, rows: [{ batch_id: values?.[0] }] };
        }
        const insert = /^INSERT INTO "public"\."([^"]+)"\s*\(([^)]+)\)/i.exec(
          text,
        );
        if (insert && insert[1] !== '_foxflow_committed_batches') {
          const columns = insert[2]!
            .split(',')
            .map((part) => part.replace(/"/g, '').trim());
          const vals = values ?? [];
          for (let i = 0; i < vals.length; i += columns.length) {
            const row: Record<string, unknown> = {};
            for (let c = 0; c < columns.length; c++) {
              row[columns[c]!] = vals[i + c] ?? null;
            }
            this.inserted.push(row);
          }
        }
        return { rowCount: 1, rows: [] };
      },
    };
  }
}

describe('cron schedule → HTTP → map → postgres', () => {
  it('fires a scheduled workflow that fetches HTTP, maps fields, and inserts rows', async () => {
    const postgres = new FakePostgres();
    const fetches: string[] = [];
    const engine = new Engine({
      databasePath: ':memory:',
      encryptionKey: randomBytes(32),
      instanceId: 'cron-http-map',
      registry: new PipeRegistry([
        new HttpSourcePipe(async (input) => {
          fetches.push(String(input));
          return new Response(
            JSON.stringify({
              data: [
                { id: 1, full_name: 'Ada Lovelace', status: 'active' },
                { id: 2, full_name: 'Grace Hopper', status: 'active' },
                { id: 3, full_name: 'Skip Me', status: 'inactive' },
              ],
            }),
            { status: 200 },
          );
        }),
        new MapPipe(),
        new ConditionPipe(),
        new PostgresSinkPipe(async () => postgres.client()),
      ]),
    });

    const cronTrigger = {
      id: 'nightly',
      kind: 'cron' as const,
      enabled: true,
      cron: '0 0 * * *',
      timezone: 'UTC',
      catchUp: 'one' as const,
      executionType: 'workflow' as const,
    };

    const workflow = parseWorkflow({
      id: 'cron-http-map-pg',
      name: 'Nightly people import',
      triggers: [cronTrigger],
      pipelines: [
        {
          id: 'main',
          name: 'main',
          pipes: [
            {
              id: 'http',
              role: 'source',
              type: 'source.api.http',
              config: {
                url: 'https://api.example.test/people',
                method: 'GET',
                recordsPath: 'data',
                batchSize: 100,
              },
            },
            {
              id: 'map',
              role: 'transform',
              type: 'transform.map',
              config: {
                mappings: {
                  id: 'id',
                  name: 'full_name',
                  status: 'status',
                },
                includeOriginal: false,
              },
            },
            {
              id: 'active',
              role: 'transform',
              type: 'transform.condition',
              config: {
                field: 'status',
                operator: 'equals',
                value: 'active',
              },
            },
            {
              id: 'sink',
              role: 'sink',
              type: 'sink.postgres',
              config: {
                table: 'people',
                columns: {
                  id: 'integer',
                  name: 'text',
                  status: 'text',
                },
              },
            },
          ],
          edges: [
            { from: 'http', to: 'map' },
            { from: 'map', to: 'active' },
            // Only the true port reaches the sink — inactive rows are dropped.
            { from: 'active', to: 'sink', fromPort: 'true' },
          ],
        },
      ],
    });

    await engine.stores.workflows.put(workflow);
    await engine.stores.schedules.put({
      workflowId: workflow.id,
      triggerId: 'nightly',
      nextFireAt: '2026-07-18T00:00:00.000Z',
      scheduleFingerprint: fingerprint(cronTrigger),
    });

    const cron = new CronCoordinator({
      workflows: engine.stores.workflows,
      schedules: engine.stores.schedules,
      scheduler: engine.scheduler,
      now: () => new Date('2026-07-18T00:01:00.000Z'),
    });
    await cron.recover();
    await engine.idle();

    const runs = await engine.stores.runs.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
    expect(runs[0]!.trigger).toBe('cron');
    expect(runs[0]!.triggerId).toBe('nightly');

    expect(fetches).toEqual(['https://api.example.test/people']);
    expect(postgres.inserted).toEqual([
      { id: 1, name: 'Ada Lovelace', status: 'active' },
      { id: 2, name: 'Grace Hopper', status: 'active' },
    ]);
    expect(postgres.committed.size).toBeGreaterThan(0);

    const pipes = await engine.stores.runs.listPipes(runs[0]!.id);
    const byId = Object.fromEntries(pipes.map((pipe) => [pipe.pipeId, pipe]));
    expect(byId.http?.processedRecords).toBe(3);
    expect(byId.sink?.processedRecords).toBe(2);

    engine.close();
  });

  it('maps the cron trigger payload and inserts a schedule audit row', async () => {
    const postgres = new FakePostgres();
    const engine = new Engine({
      databasePath: ':memory:',
      encryptionKey: randomBytes(32),
      instanceId: 'cron-payload-map',
      registry: new PipeRegistry([
        new CronTriggerSourcePipe(),
        new MapPipe(),
        new PostgresSinkPipe(async () => postgres.client()),
      ]),
    });

    const cronTrigger = {
      id: 'hourly',
      kind: 'cron' as const,
      enabled: true,
      cron: '0 * * * *',
      timezone: 'UTC',
      catchUp: 'one' as const,
      executionType: 'workflow' as const,
    };

    const workflow = parseWorkflow({
      id: 'cron-audit',
      name: 'cron-audit',
      triggers: [cronTrigger],
      pipelines: [
        {
          id: 'main',
          name: 'main',
          pipes: [
            {
              id: 'src',
              role: 'source',
              type: 'source.trigger.cron',
              config: { triggerId: 'hourly' },
            },
            {
              id: 'map',
              role: 'transform',
              type: 'transform.map',
              config: {
                mappings: {
                  scheduled_at: 'scheduledAt',
                  trigger_id: 'triggerId',
                  kind: 'kind',
                },
                includeOriginal: false,
              },
            },
            {
              id: 'sink',
              role: 'sink',
              type: 'sink.postgres',
              config: {
                table: 'ticks',
                columns: {
                  scheduled_at: 'text',
                  trigger_id: 'text',
                  kind: 'text',
                },
              },
            },
          ],
          edges: [
            { from: 'src', to: 'map' },
            { from: 'map', to: 'sink' },
          ],
        },
      ],
    });

    await engine.stores.workflows.put(workflow);
    await engine.stores.schedules.put({
      workflowId: workflow.id,
      triggerId: 'hourly',
      nextFireAt: '2026-07-18T10:00:00.000Z',
      scheduleFingerprint: fingerprint(cronTrigger),
    });

    const cron = new CronCoordinator({
      workflows: engine.stores.workflows,
      schedules: engine.stores.schedules,
      scheduler: engine.scheduler,
      now: () => new Date('2026-07-18T10:00:30.000Z'),
    });
    await cron.recover();
    await engine.idle();

    const runs = await engine.stores.runs.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
    expect(postgres.inserted).toEqual([
      {
        scheduled_at: '2026-07-18T10:00:00.000Z',
        trigger_id: 'hourly',
        kind: 'cron',
      },
    ]);

    engine.close();
  });

  it('does not enqueue a workflow when cron executionType is http', async () => {
    const postgres = new FakePostgres();
    const fetches: string[] = [];
    const engine = new Engine({
      databasePath: ':memory:',
      encryptionKey: randomBytes(32),
      instanceId: 'cron-http-job',
      registry: new PipeRegistry([
        new HttpSourcePipe(),
        new MapPipe(),
        new PostgresSinkPipe(async () => postgres.client()),
      ]),
    });

    const http = {
      url: 'https://hooks.example.com/tick',
      method: 'POST' as const,
      query: [{ key: 'source', value: 'cron', enabled: true }],
      headers: [],
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

    const workflow = parseWorkflow({
      id: 'http-scheduled',
      name: 'http-scheduled',
      triggers: [cronTrigger],
      // Pipeline would run only for executionType: workflow — prove it stays idle.
      pipelines: [
        {
          id: 'main',
          name: 'main',
          pipes: [
            {
              id: 'http',
              role: 'source',
              type: 'source.api.http',
              config: { url: 'https://api.example.test/should-not-run' },
            },
            {
              id: 'sink',
              role: 'sink',
              type: 'sink.postgres',
              config: {
                table: 'people',
                columns: { id: 'integer', name: 'text' },
              },
            },
          ],
          edges: [{ from: 'http', to: 'sink' }],
        },
      ],
    });

    await engine.stores.workflows.put(workflow);
    await engine.stores.schedules.put({
      workflowId: workflow.id,
      triggerId: 'http-job',
      nextFireAt: '2026-07-14T10:04:00.000Z',
      scheduleFingerprint: fingerprint(cronTrigger),
    });

    const cron = new CronCoordinator({
      workflows: engine.stores.workflows,
      schedules: engine.stores.schedules,
      scheduler: engine.scheduler,
      fetch: async (url) => {
        fetches.push(String(url));
        return new Response('ok', { status: 200 });
      },
      now: () => new Date('2026-07-14T10:05:30.000Z'),
    });
    await cron.recover();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.idle();

    expect(fetches).toEqual(['https://hooks.example.com/tick?source=cron']);
    expect(await engine.stores.runs.list()).toHaveLength(0);
    expect(postgres.insertedRows).toBe(0);

    engine.close();
  });
});
