/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConditionPipe,
  PipeRegistry,
  CsvSourcePipe,
  HttpSourcePipe,
  LocalRunScheduler,
  MapPipe,
  PipelineExecutor,
  PostgresSinkPipe,
  WorkflowRunner,
  parseWorkflow,
  type PostgresClient,
} from '../index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openSqliteStores } from './index.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('crash-resumable vertical workflow', () => {
  it('resumes a multi-pipeline CSV/HTTP workflow without duplicate sink batches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'foxflow-e2e-'));
    cleanup.push(directory);
    const databasePath = join(directory, 'foxflow.sqlite');
    const csvPath = join(directory, 'people.csv');
    await writeFile(csvPath, 'id,name\n1,Ada\n2,Grace\n3,Linus\n');
    const key = randomBytes(32);
    const postgres = new FakePostgres();
    const workflow = parseWorkflow({
      id: 'import',
      name: 'Import',
      pipelines: [
        {
          id: 'csv',
          name: 'CSV',
          pipes: [
            {
              id: 'csv-source',
              role: 'source',
              type: 'source.file.csv',
              config: { path: csvPath, batchSize: 1 },
            },
            {
              id: 'csv-map',
              role: 'transform',
              type: 'transform.map',
              config: {
                mappings: { id: 'id', name: 'name' },
                includeOriginal: false,
              },
            },
            {
              id: 'csv-sink',
              role: 'sink',
              type: 'sink.postgres',
              config: {
                table: 'people',
                columns: { id: 'integer', name: 'text' },
              },
            },
          ],
          edges: [
            { from: 'csv-source', to: 'csv-map' },
            { from: 'csv-map', to: 'csv-sink' },
          ],
        },
        {
          id: 'http',
          name: 'HTTP',
          pipes: [
            {
              id: 'http-source',
              role: 'source',
              type: 'source.api.http',
              config: {
                url: 'https://example.test/http',
                batchSize: 1,
              },
            },
            {
              id: 'active-only',
              role: 'transform',
              type: 'transform.condition',
              config: { field: 'active', operator: 'equals', value: true },
            },
            {
              id: 'http-sink',
              role: 'sink',
              type: 'sink.postgres',
              config: {
                table: 'people',
                columns: { id: 'integer', name: 'text' },
              },
            },
          ],
          edges: [
            { from: 'http-source', to: 'active-only' },
            { from: 'active-only', to: 'http-sink' },
          ],
        },
        {
          id: 'finalize',
          name: 'Finalize',
          pipes: [
            {
              id: 'final-source',
              role: 'source',
              type: 'source.api.http',
              config: { url: 'https://example.test/final' },
            },
            {
              id: 'final-sink',
              role: 'sink',
              type: 'sink.postgres',
              config: {
                table: 'people',
                columns: { id: 'integer', name: 'text' },
              },
            },
          ],
          edges: [{ from: 'final-source', to: 'final-sink' }],
        },
      ],
      dependencies: [
        { from: 'csv', to: 'finalize', on: 'success' },
        { from: 'http', to: 'finalize', on: 'success' },
      ],
    });
    const run = {
      id: 'run-crash',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: 'running' as const,
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      instanceId: 'crashed',
    };

    const first = openSqliteStores(databasePath, key);
    await first.runs.create(run, workflow);
    await first.runs.putPipeline({
      id: `${run.id}:csv`,
      workflowRunId: run.id,
      pipelineId: 'csv',
      status: 'running',
    });
    const controller = new AbortController();
    postgres.abortAfterNextInsert = controller;
    const partial = executor(first, postgres);
    await expect(
      partial.execute(workflow.pipelines[0]!, {
        workflowRunId: run.id,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(
      await first.checkpoints.get(run.id, 'csv', 'csv-source', '0'),
    ).toMatchObject({ cursor: { row: 1 } });
    first.close();

    const restarted = openSqliteStores(databasePath, key);
    const pipelineExecutor = executor(restarted, postgres);
    const runner = new WorkflowRunner({
      runs: restarted.runs,
      events: restarted.events,
      pipelineExecutor,
    });
    const scheduler = new LocalRunScheduler({
      runs: restarted.runs,
      events: restarted.events,
      runner,
      instanceId: 'restarted',
    });

    await scheduler.recover();

    expect(await restarted.runs.get(run.id)).toMatchObject({
      status: 'succeeded',
    });
    expect(await restarted.runs.listPipelines(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pipelineId: 'csv', status: 'succeeded' }),
        expect.objectContaining({ pipelineId: 'http', status: 'succeeded' }),
        expect.objectContaining({ pipelineId: 'finalize', status: 'succeeded' }),
      ]),
    );
    expect(postgres.committed.size).toBe(5);
    expect(postgres.insertedRows).toBe(5);
    restarted.close();
  });
});

function executor(
  stores: ReturnType<typeof openSqliteStores>,
  postgres: FakePostgres,
): PipelineExecutor {
  const http = new HttpSourcePipe(async (input) => {
    const url = String(input);
    const records = url.endsWith('/final')
      ? [{ id: 99, name: 'complete' }]
      : [
          { id: 10, name: 'HTTP', active: true },
          { id: 11, name: 'ignored', active: false },
        ];
    return new Response(JSON.stringify(records), { status: 200 });
  });
  return new PipelineExecutor({
    registry: new PipeRegistry([
      new CsvSourcePipe(),
      http,
      new MapPipe(),
      new ConditionPipe(),
      new PostgresSinkPipe(async () => postgres.client()),
    ]),
    checkpoints: stores.checkpoints,
    events: stores.events,
    runs: stores.runs,
    credentials: stores.credentials,
  });
}

class FakePostgres {
  readonly committed = new Set<string>();
  insertedRows = 0;
  abortAfterNextInsert?: AbortController;

  client(): PostgresClient {
    return {
      async connect() {},
      async end() {},
      query: async (text, values) => {
        if (text.includes('_foxflow_committed_batches') && text.includes('INSERT')) {
          const key = `${String(values?.[1])}/${String(values?.[0])}`;
          if (this.committed.has(key)) return { rowCount: 0, rows: [] };
          this.committed.add(key);
          return { rowCount: 1, rows: [{ batch_id: values?.[0] }] };
        }
        if (text.startsWith('INSERT INTO "public"."people"')) {
          const columns = 2;
          this.insertedRows += (values?.length ?? 0) / columns;
          this.abortAfterNextInsert?.abort();
          this.abortAfterNextInsert = undefined;
        }
        return { rowCount: 1, rows: [] };
      },
    };
  }
}
