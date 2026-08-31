/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The property that matters most is the last one: a deployment that sets
 * nothing must behave exactly as it did before the setting existed, because
 * every adapter's default was chosen for that driver and quietly changing one
 * would look like a flaky database.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { connectTimeoutMs, connectTimeoutSeconds, queryTimeoutMs } from './timeouts';

const ENV = ['FOX_CONNECT_TIMEOUT_MS', 'FOX_QUERY_TIMEOUT_MS'];
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe('precedence', () => {
  it('prefers the connection over everything', () => {
    process.env.FOX_CONNECT_TIMEOUT_MS = '5000';
    expect(connectTimeoutMs({ timeout: { connectMs: 1234 } }, 10_000)).toBe(1234);
  });

  it('falls back to the environment', () => {
    process.env.FOX_CONNECT_TIMEOUT_MS = '5000';
    expect(connectTimeoutMs({}, 10_000)).toBe(5000);
  });

  it('falls back to the adapter default when nothing is set', () => {
    // The behaviour every existing deployment already has.
    expect(connectTimeoutMs(undefined, 10_000)).toBe(10_000);
    expect(connectTimeoutMs({}, 15_000)).toBe(15_000);
    expect(queryTimeoutMs({}, 30_000)).toBe(30_000);
  });

  it("keeps each adapter's own default rather than one shared number", () => {
    // Oracle's listener and SQL Server's login really are slower than a
    // Postgres connect; flattening them breaks one end or the other.
    expect(connectTimeoutMs({}, 10_000)).toBe(10_000);
    expect(connectTimeoutMs({}, 15_000)).toBe(15_000);
  });
});

describe('rejecting nonsense', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores %s and uses the default',
    (bad) => {
      expect(connectTimeoutMs({ timeout: { connectMs: bad } }, 9_000)).toBe(9_000);
    }
  );

  it('ignores an unparseable environment value', () => {
    process.env.FOX_QUERY_TIMEOUT_MS = 'soon';
    expect(queryTimeoutMs({}, 30_000)).toBe(30_000);
  });

  it('ignores an empty environment value rather than reading it as zero', () => {
    process.env.FOX_CONNECT_TIMEOUT_MS = '';
    expect(connectTimeoutMs({}, 10_000)).toBe(10_000);
  });

  it('clamps a value that is too small to be meant', () => {
    expect(connectTimeoutMs({ timeout: { connectMs: 5 } }, 10_000)).toBe(250);
  });

  it('clamps a value so large it means "never give up"', () => {
    expect(connectTimeoutMs({ timeout: { connectMs: 999_999_999 } }, 10_000)).toBe(3_600_000);
  });
});

describe('seconds', () => {
  it('rounds up, because rounding down shortens the wait', () => {
    expect(connectTimeoutSeconds({ timeout: { connectMs: 1500 } }, 10_000)).toBe(2);
  });

  it('never returns zero', () => {
    expect(connectTimeoutSeconds({ timeout: { connectMs: 250 } }, 10_000)).toBe(1);
  });
});
