/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/ports.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PipeDef } from '../common/index.js';
import { PipeRegistry, type RecordBatch } from '../registry/index.js';
import {
  assertKnownFromPorts,
  defaultOutputPort,
  edgeMatchesPort,
  normalizePortedBatches,
} from './ports.js';

const pipe: PipeDef = {
  id: 'cond',
  role: 'transform',
  type: 'test.condition',
  config: {},
  concurrency: 1,
};

describe('named-port helpers', () => {
  it('normalizes Map / array / single batch outputs', () => {
    const batch: RecordBatch = {
      id: 'b',
      partitionId: '0',
      records: [{ n: 1 }],
    };
    expect(normalizePortedBatches(undefined, 'out')).toEqual([]);
    expect(normalizePortedBatches(batch, 'out')).toEqual([
      { port: 'out', batch },
    ]);
    expect(
      normalizePortedBatches([{ ...batch, port: 'true' }], 'out'),
    ).toEqual([{ port: 'true', batch: { ...batch, port: 'true' } }]);
    expect(
      normalizePortedBatches(new Map([['false', batch]]), 'out'),
    ).toEqual([{ port: 'false', batch }]);
  });

  it('matches unlabeled edges to the default port', () => {
    expect(edgeMatchesPort({ from: 'a', to: 'b' }, 'true', 'true')).toBe(true);
    expect(edgeMatchesPort({ from: 'a', to: 'b' }, 'false', 'true')).toBe(false);
    expect(
      edgeMatchesPort({ from: 'a', to: 'b', fromPort: 'false' }, 'false', 'true'),
    ).toBe(true);
  });

  it('resolves default port from metadata and validates fromPort', () => {
    const registry = new PipeRegistry([
      {
        type: 'test.condition',
        role: 'transform',
        metadata: () => ({
          type: 'test.condition',
          name: 'Condition',
          category: 'Transform',
          version: '0.1.0',
          role: 'transform',
          inputs: [{ name: 'in', type: 'records' }],
          outputs: [
            { name: 'true', type: 'records' },
            { name: 'false', type: 'records' },
          ],
          configSchema: {},
        }),
        async transform() {
          return undefined;
        },
      },
      {
        type: 'test.passthrough',
        role: 'transform',
        metadata: () => ({
          type: 'test.passthrough',
          name: 'Passthrough',
          category: 'Transform',
          version: '0.1.0',
          role: 'transform',
          inputs: [{ name: 'in', type: 'records' }],
          outputs: [
            { name: 'out', type: 'records' },
            { name: 'side', type: 'records' },
          ],
          configSchema: {},
        }),
        async transform() {
          return undefined;
        },
      },
    ]);
    const pipes = new Map([['cond', pipe]]);
    expect(defaultOutputPort(registry, pipe)).toBe('true');
    expect(
      defaultOutputPort(registry, { ...pipe, type: 'test.passthrough' }),
    ).toBe('out');
    expect(() =>
      assertKnownFromPorts(registry, pipes, [
        { from: 'cond', to: 'sink', fromPort: 'maybe' },
      ]),
    ).toThrow(/unknown fromPort "maybe"/);
    expect(() =>
      assertKnownFromPorts(registry, pipes, [
        { from: 'cond', to: 'sink', fromPort: 'false' },
      ]),
    ).not.toThrow();
  });
});
