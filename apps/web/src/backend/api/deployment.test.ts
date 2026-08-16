/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isLocalSingleUser } from './deployment';

const original = process.env.LOCAL_SINGLE_USER;

afterEach(() => {
  if (original === undefined) delete process.env.LOCAL_SINGLE_USER;
  else process.env.LOCAL_SINGLE_USER = original;
});

describe('isLocalSingleUser', () => {
  it('defaults to true and is read per call, not captured at import', () => {
    delete process.env.LOCAL_SINGLE_USER;
    expect(isLocalSingleUser()).toBe(true);
    // A module-load snapshot would keep returning true here, and the routes
    // that gate on it would stay open on a multi-user deployment.
    process.env.LOCAL_SINGLE_USER = 'false';
    expect(isLocalSingleUser()).toBe(false);
    process.env.LOCAL_SINGLE_USER = 'true';
    expect(isLocalSingleUser()).toBe(true);
  });

  it('only the exact string "false" opts out', () => {
    process.env.LOCAL_SINGLE_USER = '0';
    expect(isLocalSingleUser()).toBe(true);
  });
});
