/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/http/src/sink.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import { HttpSinkPipe } from './sink.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(
  captured: Captured[],
  status: (call: number) => number = () => 201,
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep raw */
      }
    }
    captured.push({ url: String(input), method: init?.method ?? 'GET', headers, body });
    const code = status(captured.length);
    return new Response(JSON.stringify({ id: captured.length }), {
      status: code,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function context(config: Record<string, unknown>): PipeContext {
  return {
    workflowRunId: 'run',
    pipelineId: 'pipeline',
    pipe: { id: 'out', role: 'sink', type: 'sink.http', config, concurrency: 1 },
  };
}

const batch = (records: Record<string, unknown>[]): RecordBatch => ({
  id: 'b1',
  partitionId: '0',
  records,
});

const POST_JSON = {
  url: 'https://example.test/posts',
  method: 'POST',
  headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
};

describe('HttpSinkPipe', () => {
  it('sends one request per record, interpolating record fields', async () => {
    const captured: Captured[] = [];
    const sink = new HttpSinkPipe(stub(captured));

    await sink.write(
      batch([{ title: 'First' }, { title: 'Second' }]),
      context({
        request: {
          ...POST_JSON,
          body: { mode: 'json', json: { title: '{{title}}', status: 'draft' } },
        },
      }),
    );

    expect(captured).toHaveLength(2);
    expect(captured[0]!.method).toBe('POST');
    expect(captured.map((call) => call.body)).toEqual([
      { title: 'First', status: 'draft' },
      { title: 'Second', status: 'draft' },
    ]);
  });

  it('also exposes the record under {{record.*}}', async () => {
    const captured: Captured[] = [];
    const sink = new HttpSinkPipe(stub(captured));

    await sink.write(
      batch([{ title: 'Nested' }]),
      context({
        request: {
          ...POST_JSON,
          body: { mode: 'json', json: { title: '{{record.title}}' } },
        },
      }),
    );

    expect(captured[0]!.body).toEqual({ title: 'Nested' });
  });

  it('sends the whole batch as one request in batch mode', async () => {
    const captured: Captured[] = [];
    const sink = new HttpSinkPipe(stub(captured));

    await sink.write(
      batch([{ id: 1 }, { id: 2 }, { id: 3 }]),
      context({
        mode: 'batch',
        request: {
          ...POST_JSON,
          body: { mode: 'json', json: { items: '{{records}}' } },
        },
      }),
    );

    expect(captured).toHaveLength(1);
    // A sole `{{token}}` substitutes structurally — a bulk endpoint needs a
    // real array here, not a JSON string containing one.
    expect(captured[0]!.body).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
  });

  it('does not send anything for an empty batch', async () => {
    const captured: Captured[] = [];
    const sink = new HttpSinkPipe(stub(captured));
    await sink.write(batch([]), context({ mode: 'batch', request: POST_JSON }));
    await sink.write(batch([]), context({ mode: 'record', request: POST_JSON }));
    expect(captured).toEqual([]);
  });

  it('reveals the credential once per batch, not once per record', async () => {
    const captured: Captured[] = [];
    let reveals = 0;
    const sink = new HttpSinkPipe(stub(captured));
    const ctx = context({
      request: { ...POST_JSON, auth: { type: 'bearer', token: '{{secrets.token}}' } },
    });
    ctx.pipe.credentialId = 'cred-1';
    ctx.credentials = {
      revealSecret: async () => {
        reveals++;
        return { token: 'shh' };
      },
    } as never;

    await sink.write(batch([{ id: 1 }, { id: 2 }, { id: 3 }]), ctx);

    expect(captured).toHaveLength(3);
    expect(reveals).toBe(1);
    // …and the secret still reaches every request.
    expect(captured[2]!.headers.authorization).toBe('Bearer shh');
  });

  it('fails the run on a non-2xx by default', async () => {
    const captured: Captured[] = [];
    const sink = new HttpSinkPipe(stub(captured, () => 403));

    await expect(
      sink.write(batch([{ title: 'x' }]), context({ request: POST_JSON })),
    ).rejects.toThrow(/returned 403/);
  });

  it('names the resolved URL in the failure, not the template', async () => {
    // Reporting the raw `{{…}}` template makes a 4xx read as if interpolation
    // broke, which sends you debugging the wrong layer entirely.
    const captured: Captured[] = [];
    const sink = new HttpSinkPipe(stub(captured, () => 400));
    const ctx = context({
      request: { ...POST_JSON, url: '{{vars.base}}/wp-json/wp/v2/posts' },
    });
    ctx.variables = { base: 'https://example.test' };

    await expect(sink.write(batch([{ title: 'x' }]), ctx)).rejects.toThrow(
      'https://example.test/wp-json/wp/v2/posts returned 400',
    );
  });

  it('skips failed records and keeps going when onError is skip', async () => {
    const captured: Captured[] = [];
    const sink = new HttpSinkPipe(stub(captured, (call) => (call === 1 ? 500 : 201)));

    await expect(
      sink.write(
        batch([{ title: 'bad' }, { title: 'good' }]),
        context({ request: POST_JSON, onError: 'skip', concurrency: 1 }),
      ),
    ).resolves.toBeUndefined();
    expect(captured).toHaveLength(2);
  });

  it('caps in-flight requests at `concurrency`', async () => {
    let inFlight = 0;
    let peak = 0;
    const sink = new HttpSinkPipe((async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return new Response('{}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

    await sink.write(
      batch(Array.from({ length: 6 }, (_, i) => ({ id: i }))),
      context({ request: POST_JSON, concurrency: 3 }),
    );
    expect(peak).toBe(3);
  });
});
