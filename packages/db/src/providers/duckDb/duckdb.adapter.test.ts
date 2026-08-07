/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { coerceDriverBigint } from './duckdb.adapter';

describe('coerceDriverBigint', () => {
  it('keeps safe integers as numbers', () => {
    expect(coerceDriverBigint(42n)).toBe(42);
    expect(coerceDriverBigint(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('stringifies integers past MAX_SAFE_INTEGER so PK WHERE keys are not rounded', () => {
    const unsafe = 9007199254740993n; // Number(unsafe) === 9007199254740992
    expect(Number(unsafe)).toBe(9007199254740992);
    expect(Number.isSafeInteger(Number(unsafe))).toBe(false);
    expect(coerceDriverBigint(unsafe)).toBe('9007199254740993');
  });
});
