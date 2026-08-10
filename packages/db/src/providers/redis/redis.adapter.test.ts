/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { redisRowMatchesPredicates } from './redis.adapter';

describe('redisRowMatchesPredicates', () => {
  it('matches when every non-id predicate holds', () => {
    const row = { id: '1', name: 'alice', status: 'active' };
    expect(
      redisRowMatchesPredicates(
        row,
        [
          { column: 'name', value: { kind: 'param', index: 0 } },
          { column: 'status', value: { kind: 'literal', value: 'active' } },
        ],
        ['alice']
      )
    ).toBe(true);
  });

  it('fails closed when a predicate does not match', () => {
    const row = { id: '1', name: 'alice', status: 'inactive' };
    expect(
      redisRowMatchesPredicates(
        row,
        [{ column: 'status', value: { kind: 'literal', value: 'active' } }],
        []
      )
    ).toBe(false);
  });

  it('does not treat null as matching a missing field', () => {
    const row = { id: '1', name: 'alice' };
    expect(
      redisRowMatchesPredicates(
        row,
        [{ column: 'status', value: { kind: 'literal', value: null } }],
        []
      )
    ).toBe(false);
  });
});
