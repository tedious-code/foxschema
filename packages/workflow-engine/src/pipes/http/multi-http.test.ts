/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/http/src/multi-http.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PipeContext } from '../../registry/index.js';
import { MultiHttpSourcePipe } from './multi-http.js';

function context(
  config: Record<string, unknown>,
  signal?: AbortSignal,
): PipeContext {
  return {
    workflowRunId: 'run',
    pipelineId: 'pipeline',
    pipe: {
      id: 'multi',
      role: 'source',
      type: 'source.api.http.multi',
      config,
      concurrency: 1,
    },
    signal,
  };
}

/** Collect every record the pipe emits for a config. */
async function collect(
  pipe: MultiHttpSourcePipe,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for await (const batch of pipe.read(context(config))) {
    records.push(...batch.records);
  }
  return records;
}

/** Responds with `body` for every request, recording the URLs it saw. */
function stubFetch(
  body: unknown,
  seen?: string[],
): typeof fetch {
  return (async (input: unknown) => {
    seen?.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('MultiHttpSourcePipe', () => {
  it('fetches all endpoints in parallel and tags records', async () => {
    const started: string[] = [];
    const pipe = new MultiHttpSourcePipe(async (input) => {
      const url = String(input);
      started.push(url);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const id = url.includes('users') ? 'users' : 'orders';
      return new Response(
        JSON.stringify([{ id, value: id === 'users' ? 1 : 2 }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const batches: Record<string, unknown>[] = [];
    for await (const batch of pipe.read(
      context({
        endpoints: [
          { id: 'users', url: 'https://example.test/users' },
          { id: 'orders', url: 'https://example.test/orders' },
        ],
      }),
    )) {
      batches.push(...batch.records);
    }

    expect(started).toHaveLength(2);
    expect(batches).toEqual(
      expect.arrayContaining([
        { id: 'users', value: 1, _endpoint: 'users' },
        { id: 'orders', value: 2, _endpoint: 'orders' },
      ]),
    );
    expect(batches).toHaveLength(2);
  });

  it('fails the pipe when one endpoint errors and onError is fail', async () => {
    const pipe = new MultiHttpSourcePipe(async (input) => {
      const url = String(input);
      if (url.includes('bad')) {
        return new Response('nope', { status: 500 });
      }
      return new Response(JSON.stringify([{ ok: true }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(async () => {
      for await (const _ of pipe.read(
        context({
          endpoints: [
            { id: 'ok', url: 'https://example.test/ok' },
            { id: 'bad', url: 'https://example.test/bad' },
          ],
        }),
      )) {
        // drain
      }
    }).rejects.toThrow(/bad/);
  });

  it('skips failed endpoints when onError is skip', async () => {
    const pipe = new MultiHttpSourcePipe(async (input) => {
      const url = String(input);
      if (url.includes('bad')) {
        return new Response('nope', { status: 500 });
      }
      return new Response(JSON.stringify([{ ok: true }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const batches: Record<string, unknown>[] = [];
    for await (const batch of pipe.read(
      context({
        onError: 'skip',
        endpoints: [
          { id: 'ok', url: 'https://example.test/ok' },
          { id: 'bad', url: 'https://example.test/bad' },
        ],
      }),
    )) {
      batches.push(...batch.records);
    }

    expect(batches).toEqual([{ ok: true, _endpoint: 'ok' }]);
  });

  it('caps in-flight requests at `concurrency` but still fetches every endpoint', async () => {
    let inFlight = 0;
    let peak = 0;
    const pipe = new MultiHttpSourcePipe((async (input: unknown) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return new Response(JSON.stringify([{ url: String(input) }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    const records = await collect(pipe, {
      concurrency: 2,
      endpoints: Array.from({ length: 6 }, (_, i) => ({
        id: `e${i}`,
        url: `https://example.test/${i}`,
      })),
    });

    expect(records).toHaveLength(6);
    expect(peak).toBeLessThanOrEqual(2);
    // The cap must not serialize everything — 2 workers really ran together.
    expect(peak).toBe(2);
  });

  it('extracts nested rows with recordsPath and honors a custom tagField', async () => {
    const pipe = new MultiHttpSourcePipe(
      stubFetch({ data: { items: [{ id: 1 }, { id: 2 }] } }),
    );
    const records = await collect(pipe, {
      tagField: 'source',
      endpoints: [
        {
          id: 'catalog',
          url: 'https://example.test/catalog',
          recordsPath: 'data.items',
        },
      ],
    });
    expect(records).toEqual([
      { id: 1, source: 'catalog' },
      { id: 2, source: 'catalog' },
    ]);
  });

  it('wraps a single object response as one record', async () => {
    const pipe = new MultiHttpSourcePipe(stubFetch({ id: 7, name: 'solo' }));
    const records = await collect(pipe, {
      endpoints: [{ id: 'one', url: 'https://example.test/one' }],
    });
    expect(records).toEqual([{ id: 7, name: 'solo', _endpoint: 'one' }]);
  });

  it('rejects duplicate endpoint ids — tags would be ambiguous', async () => {
    const pipe = new MultiHttpSourcePipe(stubFetch([{ id: 1 }]));
    await expect(
      collect(pipe, {
        endpoints: [
          { id: 'dup', url: 'https://example.test/a' },
          { id: 'dup', url: 'https://example.test/b' },
        ],
      }),
    ).rejects.toThrow(/unique ids/);
  });

  it('names the offending endpoint when a response is not record-shaped', async () => {
    const scalars = new MultiHttpSourcePipe(stubFetch([1, 2, 3]));
    await expect(
      collect(scalars, {
        endpoints: [{ id: 'nums', url: 'https://example.test/nums' }],
      }),
    ).rejects.toThrow(/"nums" records\[0\] must be a JSON object/);

    const missing = new MultiHttpSourcePipe(stubFetch({ data: {} }));
    await expect(
      collect(missing, {
        endpoints: [
          {
            id: 'empty',
            url: 'https://example.test/empty',
            recordsPath: 'data.items',
          },
        ],
      }),
    ).rejects.toThrow(/"empty" response is empty/);
  });

  it('splits the combined result into batches with a resumable offset cursor', async () => {
    const pipe = new MultiHttpSourcePipe(
      stubFetch(Array.from({ length: 5 }, (_, i) => ({ id: i }))),
    );
    const batches = [];
    for await (const batch of pipe.read(
      context({
        batchSize: 2,
        endpoints: [{ id: 'bulk', url: 'https://example.test/bulk' }],
      }),
    )) {
      batches.push(batch);
    }
    expect(batches.map((batch) => batch.records.length)).toEqual([2, 2, 1]);
    expect(batches.map((batch) => batch.cursor)).toEqual([
      { offset: 2 },
      { offset: 4 },
      { offset: 5 },
    ]);

    // A resumed run picks up where the cursor left off.
    const resumed = context({
      batchSize: 2,
      endpoints: [{ id: 'bulk', url: 'https://example.test/bulk' }],
    });
    resumed.checkpoint = {
      workflowRunId: 'run',
      pipelineId: 'pipeline',
      pipeId: 'multi',
      partitionId: '0',
      cursor: { offset: 4 },
      updatedAt: new Date().toISOString(),
    };
    const rest = [];
    for await (const batch of pipe.read(resumed)) rest.push(...batch.records);
    expect(rest).toEqual([{ id: 4, _endpoint: 'bulk' }]);
  });
});
