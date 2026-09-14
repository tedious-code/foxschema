/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Durations: the grammar a retry policy is validated with is the one the
 * scheduler reads it with.
 */
import { describe, expect, it } from 'vitest';
import { parseDurationMs, retryConfigSchema } from './workflow.js';

describe('parseDurationMs', () => {
  it.each([
    ['500ms', 500],
    ['5s', 5_000],
    ['1.5s', 1_500],
    ['5m', 300_000],
    ['1h', 3_600_000],
    ['1d', 86_400_000],
    ['0s', 0],
  ])('reads %s as %i ms', (value, ms) => {
    expect(parseDurationMs(value)).toBe(ms);
  });

  it.each(['5', 's', '5x', '-5s', '1.s', '5 s', ''])('rejects %j', (value) => {
    expect(parseDurationMs(value)).toBeUndefined();
  });
});

describe('retry policy durations', () => {
  it('saves every duration the scheduler can read, and nothing it cannot', () => {
    // These used to disagree: validation took "1d" and "1.5s", which the
    // scheduler silently replaced with its default backoff, and refused "500ms",
    // which the scheduler understood.
    for (const value of ['500ms', '1.5s', '1d']) {
      expect(retryConfigSchema.safeParse({ minBackoffDuration: value }).success, value).toBe(true);
    }
    expect(retryConfigSchema.safeParse({ minBackoffDuration: '5x' }).success).toBe(false);
  });
});
