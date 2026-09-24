/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { Page, Response } from 'playwright';
import { clickRateLimited } from './rate-limited.js';

function response(status: number, headers: Record<string, string> = {}, body = ''): Response {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    headers: () => headers,
    text: async () => body,
    url: () => 'http://localhost:5199/api/lokee/capture',
    request: () => ({ method: () => 'POST' }),
  } as unknown as Response;
}

/** A page whose responses come from `answers`, one per press. */
function fakePage(answers: Response[]) {
  const waits: number[] = [];
  const page = {
    waitForResponse: vi.fn(async (match: (r: Response) => boolean) => {
      const next = answers.shift();
      if (!next) throw new Error('no more responses');
      expect(match(next)).toBe(true);
      return next;
    }),
    waitForTimeout: vi.fn(async (ms: number) => {
      waits.push(ms);
    }),
  } as unknown as Page;
  return { page, waits };
}

const path = /\/api\/lokee\/capture$/;

describe('clickRateLimited', () => {
  it('returns the response when the first press is accepted', async () => {
    const { page, waits } = fakePage([response(200)]);
    const click = vi.fn(async () => undefined);
    const res = await clickRateLimited(page, { click, path, label: 'Snapshot' });
    expect(res.status()).toBe(200);
    expect(click).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('waits out Retry-After on a 429 and presses again', async () => {
    const { page, waits } = fakePage([response(429, { 'retry-after': '7' }), response(200)]);
    const click = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await clickRateLimited(page, { click, path, label: 'Snapshot' });
    expect(click).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([7_250]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rate limited, waiting 8s'));
    warn.mockRestore();
  });

  it('fails at once, naming the refusal, when the wait would exceed the budget', async () => {
    const { page, waits } = fakePage([response(429, { 'retry-after': '60' }, '{"code":"rate_limited"}')]);
    await expect(
      clickRateLimited(page, { click: async () => undefined, path, label: 'Snapshot', maxWaitMs: 10_000 })
    ).rejects.toThrow(/Snapshot refused: rate limited \(HTTP 429, retry after 61s/);
    expect(waits).toEqual([]);
  });

  it('fails at once on any other error, with its status and body', async () => {
    const { page } = fakePage([response(500, {}, '{"error":"boom"}')]);
    await expect(
      clickRateLimited(page, { click: async () => undefined, path, label: 'Revert' })
    ).rejects.toThrow('Revert failed: HTTP 500 {"error":"boom"}');
  });
});
