/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/db/src/temporal-precision.test.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TEMPORAL_OIDS,
  preserveTemporalPrecision,
  resetTemporalParsersForTest,
} from './postgres-source.js';

/**
 * PostgreSQL keeps microseconds; a JavaScript `Date` holds milliseconds, and
 * the driver parses timestamps into `Date` by default. A 1,000,000-row copy
 * between two PostgreSQL databases therefore arrived with every `placed_at`
 * truncated — `00:13:43.509878` became `00:13:43.509`. Row counts matched, so
 * nothing looked wrong.
 */
describe('temporal precision', () => {
  beforeEach(() => resetTemporalParsersForTest());

  it('registers a pass-through parser for every date/time type', () => {
    const registered = new Map<number, (value: string) => unknown>();
    preserveTemporalPrecision({
      setTypeParser: (oid, parse) => registered.set(oid, parse),
    });

    expect([...registered.keys()].sort()).toEqual([...TEMPORAL_OIDS].sort());
  });

  it('returns the text PostgreSQL sent, microseconds intact', () => {
    const registered = new Map<number, (value: string) => unknown>();
    preserveTemporalPrecision({
      setTypeParser: (oid, parse) => registered.set(oid, parse),
    });

    const raw = '2026-03-23 00:13:43.509878+00';
    for (const oid of TEMPORAL_OIDS) {
      const parsed = registered.get(oid)!(raw);
      expect(parsed, `OID ${oid} must not convert`).toBe(raw);
      // The bug was specifically a Date: it cannot hold the last three digits.
      expect(parsed).not.toBeInstanceOf(Date);
      expect(String(parsed)).toContain('.509878');
    }
  });

  it('installs once, so repeated client creation is cheap', () => {
    let calls = 0;
    const types = { setTypeParser: () => void calls++ };

    preserveTemporalPrecision(types);
    preserveTemporalPrecision(types);
    preserveTemporalPrecision(types);

    expect(calls).toBe(TEMPORAL_OIDS.length);
  });
});
