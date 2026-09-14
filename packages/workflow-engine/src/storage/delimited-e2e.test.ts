/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/delimited-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, parseWorkflow, type WorkflowDef } from '../index.js';

/**
 * Delimited sources end-to-end through the real Engine: CSV schema/regex
 * validation (fail and skip) and the text source's offset + multi-delimiter
 * flat map, exactly as a designer-built workflow would run them.
 */

function engineFor(): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'delimited-e2e',
  });
}

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

async function tempFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'foxflow-delimited-e2e-'));
  cleanup.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

function workflowWith(
  id: string,
  type: string,
  config: Record<string, unknown>,
): WorkflowDef {
  return parseWorkflow({
    id,
    name: id,
    triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
    pipelines: [
      {
        id: 'main',
        name: 'main',
        pipes: [{ id: 'src', role: 'source', type, config }],
        edges: [],
      },
    ],
  });
}

async function runWorkflow(
  engine: Engine,
  workflow: WorkflowDef,
): Promise<{ status: string; processedRecords: number; error?: string }> {
  await engine.stores.workflows.put(workflow);
  const { run } = await engine.scheduler.enqueue(workflow);
  await engine.idle();
  const stored = await engine.stores.runs.get(run!.id);
  const pipes = await engine.stores.runs.listPipes(run!.id);
  return {
    status: stored?.status ?? 'missing',
    processedRecords: pipes[0]?.processedRecords ?? 0,
    ...(stored?.error ? { error: stored.error } : {}),
  };
}

describe('delimited sources end-to-end', () => {
  it('runs a text-source workflow: offset + multi delimiter + flat map', async () => {
    const engine = engineFor();
    const path = await tempFile(
      'report.txt',
      'DAILY REPORT\n1;ada@example.com|2::grace@example.com\n3;linus@example.com\n',
    );
    const outcome = await runWorkflow(
      engine,
      workflowWith('text-flatmap', 'source.file.text', {
        path,
        offset: 1,
        delimiters: [';', '::'],
        recordDelimiter: '|',
        fields: ['id', 'email'],
      }),
    );
    expect(outcome).toEqual({ status: 'succeeded', processedRecords: 3 });
    engine.close();
  });

  it('skips CSV rows that fail the regex schema when onInvalid is skip', async () => {
    const engine = engineFor();
    const path = await tempFile(
      'users.csv',
      'id,email\n1,ada@example.com\nbad,nope\n3,linus@example.com\n',
    );
    const outcome = await runWorkflow(
      engine,
      workflowWith('csv-skip', 'source.file.csv', {
        path,
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: '^\\d+$' },
            email: { type: 'string', pattern: '^\\S+@\\S+$' },
          },
        },
        onInvalid: 'skip',
      }),
    );
    expect(outcome).toEqual({ status: 'succeeded', processedRecords: 2 });
    engine.close();
  });

  it('fails the run on the first invalid CSV row by default', async () => {
    const engine = engineFor();
    const path = await tempFile('users.csv', 'id\n1\nx\n');
    const outcome = await runWorkflow(
      engine,
      workflowWith('csv-fail', 'source.file.csv', {
        path,
        schema: {
          type: 'object',
          properties: { id: { type: 'string', pattern: '^\\d+$' } },
        },
      }),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/row 2 failed schema/);
    engine.close();
  });

  it('routes rejected rows to a dead-letter branch via the rejects port', async () => {
    const engine = engineFor();
    const path = await tempFile(
      'users.csv',
      'id,email\n1,ada@example.com\nbad,nope\n3,linus@example.com\n',
    );
    const workflow = parseWorkflow({
      id: 'csv-dead-letter',
      name: 'csv-dead-letter',
      triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
      pipelines: [
        {
          id: 'main',
          name: 'main',
          pipes: [
            {
              id: 'src',
              role: 'source',
              type: 'source.file.csv',
              config: {
                path,
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', pattern: '^\\d+$' },
                    email: { type: 'string', pattern: '^\\S+@\\S+$' },
                  },
                },
                onInvalid: 'reject',
              },
            },
            // Pass-through counters for each branch.
            { id: 'ok', role: 'transform', type: 'transform.merge', config: {} },
            { id: 'bad', role: 'transform', type: 'transform.merge', config: {} },
          ],
          edges: [
            { from: 'src', to: 'ok' },
            { from: 'src', to: 'bad', fromPort: 'rejects' },
          ],
        },
      ],
    });
    await engine.stores.workflows.put(workflow);
    const { run } = await engine.scheduler.enqueue(workflow);
    await engine.idle();

    expect((await engine.stores.runs.get(run!.id))?.status).toBe('succeeded');
    const pipes = await engine.stores.runs.listPipes(run!.id);
    const stats = Object.fromEntries(
      pipes.map((pipe) => [pipe.pipeId, pipe.processedRecords]),
    );
    // 2 valid rows flow out the default port, 1 dead-letters via rejects.
    expect(stats.ok).toBe(2);
    expect(stats.bad).toBe(1);
    engine.close();
  });

  it('applies text-source validation inside a workflow run', async () => {
    const engine = engineFor();
    const path = await tempFile(
      'mixed.txt',
      '1;ada@example.com\nbroken line\n3;linus@example.com\n',
    );
    const outcome = await runWorkflow(
      engine,
      workflowWith('text-validate', 'source.file.text', {
        path,
        delimiters: [';'],
        fields: ['id', 'email'],
        schema: {
          type: 'object',
          properties: { email: { type: 'string', pattern: '^\\S+@\\S+$' } },
        },
        onInvalid: 'skip',
      }),
    );
    expect(outcome).toEqual({ status: 'succeeded', processedRecords: 2 });
    engine.close();
  });
});
