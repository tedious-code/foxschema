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
  MOCK_PALETTE_GROUPS,
  MOCK_PIPES,
  MOCK_TRIGGERS,
  pipeFamily,
  type PipeTypeId,
} from './mockWorkflow';

describe('FoxFlow-aligned workflow mock', () => {
  it('uses only known FoxFlow pipe type ids on the canvas and palette', () => {
    const known = new Set<string>(FOXFLOW_PIPE_TYPES);
    const used = new Set<PipeTypeId>([
      ...MOCK_PIPES.map((p) => p.type),
      ...MOCK_PALETTE_GROUPS.flatMap((g) => g.items).map((p) => p.type),
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

  it('groups the palette into triggers · process · transform · notification · control', () => {
    expect(MOCK_PALETTE_GROUPS.map((g) => g.id)).toEqual([
      'triggers',
      'process',
      'transform',
      'notification',
      'control',
    ]);
    expect(MOCK_PALETTE_GROUPS.every((g) => g.items.length > 0)).toBe(true);

    const triggerTypes = MOCK_PALETTE_GROUPS.find((g) => g.id === 'triggers')!.items.map(
      (i) => i.type,
    );
    expect(triggerTypes).toEqual(
      expect.arrayContaining([
        'source.trigger.manual',
        'source.trigger.cron',
        'source.trigger.webhook',
      ]),
    );
    expect(
      MOCK_PALETTE_GROUPS.find((g) => g.id === 'notification')!.items.map((i) => i.type),
    ).toContain('sink.email');
  });

  it('maps pipe types onto the product palette groups', () => {
    expect(pipeFamily('source.trigger.cron')).toBe('triggers');
    expect(pipeFamily('source.db.postgres')).toBe('process');
    expect(pipeFamily('sink.postgres')).toBe('process');
    expect(pipeFamily('transform.merge')).toBe('transform');
    expect(pipeFamily('logic.loop')).toBe('transform');
    expect(pipeFamily('sink.email')).toBe('notification');
    expect(pipeFamily('workflow.sub')).toBe('control');
    expect(pipeFamily('human.gate')).toBe('control');
  });
});
