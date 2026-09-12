/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Contract tests: Workflow mock data stays aligned with FoxFlow pipe / trigger shapes.
 */
import { describe, expect, it } from 'vitest';
import {
  FOXFLOW_PIPE_TYPES,
  MOCK_PALETTE,
  MOCK_PIPES,
  MOCK_TRIGGERS,
  type PipeTypeId,
} from './mockWorkflow';

describe('FoxFlow-aligned workflow mock', () => {
  it('uses only known FoxFlow pipe type ids on the canvas and palette', () => {
    const known = new Set<string>(FOXFLOW_PIPE_TYPES);
    const used = new Set<PipeTypeId>([
      ...MOCK_PIPES.map((p) => p.type),
      ...MOCK_PALETTE.map((p) => p.type),
    ]);
    for (const type of used) {
      expect(known.has(type), `unknown pipe type: ${type}`).toBe(true);
    }
  });

  it('exposes FoxFlow workflow trigger kinds', () => {
    const kinds = MOCK_TRIGGERS.map((t) => t.kind).sort();
    expect(kinds).toEqual(['cron', 'http', 'manual', 'parent', 'webhook'].sort());
    expect(MOCK_TRIGGERS.some((t) => t.kind === 'cron' && t.enabled)).toBe(true);
  });

  it('includes condition / merge / sub-workflow control pipes', () => {
    const types = MOCK_PIPES.map((p) => p.type);
    expect(types).toContain('transform.condition');
    expect(types).toContain('transform.merge');
    expect(types).toContain('workflow.sub');
    expect(types).toContain('source.trigger.cron');
    expect(types).toContain('sink.email');
  });
});
