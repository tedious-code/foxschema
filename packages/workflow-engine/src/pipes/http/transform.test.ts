/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/http/src/transform.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { HttpTransformPipe } from './transform.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';

interface Seen {
  url: string;
  body?: string;
}

function stub(seen: Seen[], reply: (call: number) => { status: number; body: unknown }) {
  let call = 0;
  return (async (input: string | URL, init?: RequestInit) => {
    call += 1;
    seen.push({ url: String(input), ...(init?.body ? { body: String(init.body) } : {}) });
    const { status, body } = reply(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function context(config: Record<string, unknown>): PipeContext {
  return {
    pipe: { id: 'call', type: 'transform.http', role: 'transform', config, concurrency: 1 },
    variables: { base: 'https://api.test' },
  } as unknown as PipeContext;
}

const batch = (records: Record<string, unknown>[]): RecordBatch => ({
  id: 'call:0:1-1',
  partitionId: '0',
  records,
});

describe('HttpTransformPipe', () => {
  it('builds the request from the record and keeps the response', async () => {
    const seen: Seen[] = [];
    const pipe = new HttpTransformPipe(stub(seen, () => ({ status: 200, body: { id: 77 } })));

    const ports = await pipe.transform(
      batch([{ slug: 'schema-drift' }]),
      context({
        request: { method: 'GET', url: '{{base}}/posts/{{slug}}' },
        outputField: 'api',
      }),
    );

    // The URL came from the row — the thing neither source nor sink can do.
    expect(seen[0]!.url).toBe('https://api.test/posts/schema-drift');
    expect(ports.get('out')!.records[0]).toEqual({
      slug: 'schema-drift',
      api: { id: 77 },
    });
  });

  it('records the status when asked, for downstream branching', async () => {
    const pipe = new HttpTransformPipe(stub([], () => ({ status: 201, body: { ok: 1 } })));

    const ports = await pipe.transform(
      batch([{ n: 1 }]),
      context({
        request: { method: 'POST', url: 'https://api.test/x' },
        statusField: 'httpStatus',
      }),
    );

    expect(ports.get('out')!.records[0]!.httpStatus).toBe(201);
  });

  it('fails the run on a non-2xx by default, naming the resolved URL', async () => {
    const pipe = new HttpTransformPipe(stub([], () => ({ status: 500, body: {} })));

    await expect(
      pipe.transform(
        batch([{ id: 5 }]),
        context({ request: { method: 'GET', url: '{{base}}/thing/{{id}}' } }),
      ),
    ).rejects.toThrow('https://api.test/thing/5 returned 500');
  });

  it('dead-letters the failed record instead of losing it when onError is skip', async () => {
    // A row that could not be enriched is worth looking at, not worth dropping.
    const pipe = new HttpTransformPipe(
      stub([], (call) => (call === 2 ? { status: 404, body: {} } : { status: 200, body: { ok: 1 } })),
    );

    const ports = await pipe.transform(
      batch([{ id: 1 }, { id: 2 }, { id: 3 }]),
      context({
        request: { method: 'GET', url: '{{base}}/thing/{{id}}' },
        concurrency: 1,
        onError: 'skip',
      }),
    );

    expect(ports.get('out')!.records.map((r) => r.id)).toEqual([1, 3]);
    const rejects = ports.get('rejects')!;
    expect(rejects.records[0]!.id).toBe(2);
    expect(String(rejects.records[0]!._error)).toContain('returned 404');
    // Dead-letter batches never carry a cursor.
    expect(rejects.cursor).toBeUndefined();
  });

  it('preserves input order at concurrency > 1', async () => {
    // Later calls answer sooner, so completion order is not input order.
    const pipe = new HttpTransformPipe((async (input: string | URL) => {
      const id = Number(String(input).split('/').pop());
      await new Promise((resolve) => setTimeout(resolve, (5 - id) * 5));
      return new Response(JSON.stringify({ id }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);

    const ports = await pipe.transform(
      batch([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
      context({ request: { method: 'GET', url: '{{base}}/n/{{id}}' }, concurrency: 4 }),
    );

    expect(ports.get('out')!.records.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('emits no output port for an empty batch', async () => {
    const pipe = new HttpTransformPipe(stub([], () => ({ status: 200, body: {} })));

    const ports = await pipe.transform(
      batch([]),
      context({ request: { method: 'GET', url: 'https://api.test/x' } }),
    );

    expect(ports.size).toBe(0);
  });
});

describe('dry-run safety', () => {
  it('declares sideEffects so a dry run stands in for it', () => {
    // Not cosmetic metadata. `dryRunWorkflow` substitutes a transform only
    // when this is set, and executes it for real otherwise — so while this was
    // missing, `npm run smoke` sent a live POST to oauth2.googleapis.com every
    // time it ran. The script exists precisely to keep demos off the network.
    expect(new HttpTransformPipe().metadata().sideEffects).toBe(true);
  });
});
