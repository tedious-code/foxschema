/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/json.test.ts).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import { JsonSourcePipe } from './index.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

async function tempFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'foxflow-json-'));
  cleanup.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

function context(config: Record<string, unknown>): PipeContext {
  return {
    workflowRunId: 'run',
    pipelineId: 'pipeline',
    pipe: { id: 'json', type: 'source.file.json', role: 'source', config, concurrency: 1 },
  };
}

async function collect(ctx: PipeContext): Promise<RecordBatch[]> {
  const source = new JsonSourcePipe();
  const batches: RecordBatch[] = [];
  for await (const batch of source.read(ctx)) batches.push(batch);
  return batches;
}

describe('JsonSourcePipe', () => {
  it('auto-detects a JSON array and streams it in batches with an index cursor', async () => {
    const path = await tempFile(
      'items.json',
      JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]),
    );
    const batches = await collect(context({ path, batchSize: 2 }));
    expect(batches.map((batch) => batch.records)).toEqual([
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }],
    ]);
    expect(batches[0]!.cursor).toEqual({ index: 2 });
    expect(batches[1]!.cursor).toEqual({ index: 3 });
  });

  it('auto-detects NDJSON, skips blank lines, and wraps scalars', async () => {
    const path = await tempFile(
      'events.ndjson',
      '{"id":1}\n\n"plain"\n[1,2]\n',
    );
    const batches = await collect(context({ path }));
    expect(batches.flatMap((batch) => batch.records)).toEqual([
      { id: 1 },
      { value: 'plain' },
      { value: [1, 2] },
    ]);
    expect(batches.at(-1)!.cursor).toEqual({ line: 4 });
  });

  it('resumes each layout from its own cursor', async () => {
    const arrayPath = await tempFile('a.json', JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }]));
    const arrayCtx = context({ path: arrayPath });
    arrayCtx.checkpoint = {
      workflowRunId: 'run', pipelineId: 'pipeline', pipeId: 'json',
      partitionId: '0', cursor: { index: 2 }, updatedAt: new Date().toISOString(),
    };
    expect((await collect(arrayCtx)).flatMap((b) => b.records)).toEqual([{ n: 3 }]);

    const ndPath = await tempFile('b.ndjson', '{"n":1}\n{"n":2}\n{"n":3}\n');
    const ndCtx = context({ path: ndPath });
    ndCtx.checkpoint = {
      workflowRunId: 'run', pipelineId: 'pipeline', pipeId: 'json',
      partitionId: '0', cursor: { line: 2 }, updatedAt: new Date().toISOString(),
    };
    expect((await collect(ndCtx)).flatMap((b) => b.records)).toEqual([{ n: 3 }]);
  });

  it('treats a malformed NDJSON line by the onInvalid policy', async () => {
    const path = await tempFile('bad.ndjson', '{"ok":1}\nnot json\n{"ok":2}\n');
    await expect(collect(context({ path }))).rejects.toThrow(/line 2 failed to parse/);

    const skipped = await collect(context({ path, onInvalid: 'skip' }));
    expect(skipped.flatMap((b) => b.records)).toEqual([{ ok: 1 }, { ok: 2 }]);

    const rejected = await collect(context({ path, onInvalid: 'reject' }));
    const rejects = rejected.filter((b) => b.port === 'rejects');
    expect(rejects).toHaveLength(1);
    expect(rejects[0]!.records[0]).toMatchObject({ _raw: 'not json', _line: 2 });
    expect(rejects[0]!.cursor).toBeUndefined();
  });

  it('validates records against the schema like the other sources', async () => {
    const path = await tempFile(
      'users.json',
      JSON.stringify([
        { email: 'ada@example.com' },
        { email: 'nope' },
      ]),
    );
    const schema = {
      type: 'object',
      properties: { email: { type: 'string', pattern: '^\\S+@\\S+$' } },
    };
    const batches = await collect(
      context({ path, schema, onInvalid: 'reject' }),
    );
    const data = batches.filter((b) => b.port === undefined);
    const rejects = batches.filter((b) => b.port === 'rejects');
    expect(data.flatMap((b) => b.records)).toEqual([{ email: 'ada@example.com' }]);
    expect(rejects.flatMap((b) => b.records)).toEqual([
      {
        email: 'nope',
        _error: expect.stringMatching(/pattern/),
        _index: 2,
      },
    ]);
  });

  it('rejects a non-array top level in array mode', async () => {
    const path = await tempFile('obj.json', '{"not":"an array"}');
    await expect(collect(context({ path, format: 'array' }))).rejects.toThrow(
      /top-level JSON array/,
    );
  });
});
