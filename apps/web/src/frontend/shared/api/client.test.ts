/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the shared HTTP client.
 *
 * The defaults are the point of this module: every call must carry the session
 * cookie and the JSON content type without the caller arranging it, because a
 * missing `credentials` works in single-user mode and fails only once
 * multi-user auth is enabled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, ApiError } from './client';

const realFetch = globalThis.fetch;

/** Capture what the client sends, and reply with whatever the test wants. */
function stubFetch(reply: { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const status = reply.status ?? 200;
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => text,
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('request defaults', () => {
  it('sends the session cookie on every method', async () => {
    for (const send of [
      () => api.get('/thing'),
      () => api.post('/thing', {}),
      () => api.put('/thing', {}),
      () => api.patch('/thing', {}),
      () => api.delete('/thing'),
    ]) {
      const calls = stubFetch({ body: { ok: true } });
      await send();
      expect(calls[0]!.init.credentials).toBe('include');
    }
  });

  it('uses the API base and the given path', async () => {
    const calls = stubFetch({ body: {} });
    await api.get('/updates/check');
    expect(calls[0]!.url).toBe('/api/updates/check');
  });

  it.each([
    ['get', () => api.get('/x'), 'GET'],
    ['post', () => api.post('/x', {}), 'POST'],
    ['put', () => api.put('/x', {}), 'PUT'],
    ['patch', () => api.patch('/x', {}), 'PATCH'],
    ['delete', () => api.delete('/x'), 'DELETE'],
  ])('%s sends the right method', async (_name, send, method) => {
    const calls = stubFetch({ body: {} });
    await send();
    expect(calls[0]!.init.method).toBe(method);
  });

  it('sends a JSON content type only when there is a body', async () => {
    const withBody = stubFetch({ body: {} });
    await api.post('/x', { a: 1 });
    expect((withBody[0]!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    expect(withBody[0]!.init.body).toBe('{"a":1}');

    const withoutBody = stubFetch({ body: {} });
    await api.get('/x');
    expect((withoutBody[0]!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(withoutBody[0]!.init.body).toBeUndefined();
  });
});

describe('query strings', () => {
  it('appends and encodes parameters', async () => {
    const calls = stubFetch({ body: {} });
    await api.get('/driver/check', { query: { dialect: 'sql server', limit: 20 } });
    expect(calls[0]!.url).toBe('/api/driver/check?dialect=sql+server&limit=20');
  });

  it('drops entries with no value', async () => {
    // Callers pass optional filters straight through, so undefined must not
    // become the string "undefined".
    const calls = stubFetch({ body: {} });
    await api.get('/x', { query: { a: 1, b: undefined, c: null, d: false } });
    expect(calls[0]!.url).toBe('/api/x?a=1&d=false');
  });

  it('keeps a query already present on the path', async () => {
    const calls = stubFetch({ body: {} });
    await api.get('/x?first=1', { query: { second: 2 } });
    expect(calls[0]!.url).toBe('/api/x?first=1&second=2');
  });
});

describe('failures', () => {
  it('throws ApiError carrying the server message and code', async () => {
    stubFetch({ status: 400, body: { ok: false, error: 'source is required.', code: 'invalid_input' } });
    const err = await api.post('/compare', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('source is required.');
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).code).toBe('invalid_input');
  });

  it('falls back to a status message when the body has no error text', async () => {
    stubFetch({ status: 500, body: {} });
    const err = await api.get('/x').catch((e: unknown) => e);
    expect((err as ApiError).message).toContain('500');
  });

  it('reports an empty response rather than returning undefined', async () => {
    stubFetch({ status: 200, text: '' });
    await expect(api.get('/x')).rejects.toThrow(/Empty response/);
  });

  it('accepts an empty response when the caller allows it', async () => {
    stubFetch({ status: 200, text: '' });
    await expect(api.get('/x', { allowEmpty: true })).resolves.toEqual({});
  });
});

describe('raw', () => {
  it('returns the response without parsing or checking status', async () => {
    // Used for streamed NDJSON and file downloads, where the caller reads the
    // body itself.
    stubFetch({ status: 409, text: 'not json' });
    const res = await api.raw('POST', '/migration/execute', { steps: [] });
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('not json');
  });
});
