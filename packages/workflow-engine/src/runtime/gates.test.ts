/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/gates.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { evaluateGate } from './gates.js';

describe('evaluateGate', () => {
  it('evaluates literals and payload comparisons', () => {
    expect(evaluateGate('true', {})).toBe(true);
    expect(evaluateGate('false', {})).toBe(false);
    expect(
      evaluateGate('payload.count > 0', { payload: { count: 2 } }),
    ).toBe(true);
    expect(
      evaluateGate('payload.status == "ok"', { payload: { status: 'ok' } }),
    ).toBe(true);
    expect(
      evaluateGate('payload.nested.flag', {
        payload: { nested: { flag: true } },
      }),
    ).toBe(true);
  });

  it('rejects unsupported expressions', () => {
    expect(() => evaluateGate('1 + 1', {})).toThrow(/unsupported gate/);
  });
});
