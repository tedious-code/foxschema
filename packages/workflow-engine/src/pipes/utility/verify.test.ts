/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/verify.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { VerifyPipe, verifyRecord, type VerifyConfig } from './verify.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';

/**
 * The cases worth pinning are the ones where a lenient answer is the dangerous
 * one: a check that quietly passes is worse than no check, because something
 * downstream now trusts the record.
 */

function config(overrides: Partial<VerifyConfig> = {}): VerifyConfig {
  return {
    rules: [],
    minScore: 1,
    onInvalid: 'reject',
    outputField: 'verification',
    ...overrides,
  } as VerifyConfig;
}

function contextFor(cfg: Partial<VerifyConfig>): PipeContext {
  return {
    workflowRunId: 'run-1',
    pipelineId: 'main',
    pipe: { id: 'check', type: 'transform.verify', role: 'transform', config: cfg },
  } as never;
}

function batch(records: Record<string, unknown>[]): RecordBatch {
  return { id: 'b1', records } as never;
}

describe('verifying one record', () => {
  it('passes when every rule holds', () => {
    const verdict = verifyRecord(
      { title: 'A good title', score: 0.9 },
      config({ rules: [{ field: 'title', op: 'notEmpty' }, { field: 'score', op: 'gte', value: 0.7 }] }),
    );

    expect(verdict).toMatchObject({ ok: true, score: 1, failures: [] });
  });

  it('reports which rule failed and why', () => {
    const verdict = verifyRecord(
      { title: '', score: 0.4 },
      config({
        rules: [
          { field: 'title', op: 'notEmpty', message: 'title must not be blank' },
          { field: 'score', op: 'gte', value: 0.7 },
        ],
      }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.score).toBe(0);
    expect(verdict.failures.map((f) => f.message)).toEqual([
      'title must not be blank',
      'score failed gte',
    ]);
  });

  it('fails a rule on a missing field instead of throwing', () => {
    // A numeric comparison against undefined is NaN. Throwing would abort the
    // whole batch over one bad row, which is the opposite of a dead-letter.
    const verdict = verifyRecord(
      {},
      config({ rules: [{ field: 'score', op: 'gte', value: 0.7 }] }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toHaveLength(1);
  });

  it('anchors a pattern so a longer string cannot slip through', () => {
    // Unanchored, `\d{6}` matches inside `abc123456xyz`.
    const cfg = config({ rules: [{ field: 'code', op: 'matches', value: '\\d{6}' }] });

    expect(verifyRecord({ code: '123456' }, cfg).ok).toBe(true);
    expect(verifyRecord({ code: 'abc123456xyz' }, cfg).ok).toBe(false);
  });

  it('scores partial passes and honours minScore', () => {
    const rules: VerifyConfig['rules'] = [
      { field: 'a', op: 'notEmpty' },
      { field: 'b', op: 'notEmpty' },
      { field: 'c', op: 'notEmpty' },
      { field: 'd', op: 'notEmpty' },
    ];
    const record = { a: 'x', b: 'y', c: 'z', d: '' };

    // Three of four. Binding by default …
    expect(verifyRecord(record, config({ rules })).ok).toBe(false);
    // … advisory when the caller says so.
    expect(verifyRecord(record, config({ rules, minScore: 0.7 })).ok).toBe(true);
    expect(verifyRecord(record, config({ rules })).score).toBeCloseTo(0.75);
  });

  it('uses the same JSON Schema validator as the rest of the engine', () => {
    const cfg = config({
      schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    });

    expect(verifyRecord({ id: 'a' }, cfg).ok).toBe(true);
    expect(verifyRecord({ id: 7 }, cfg).ok).toBe(false);
  });

  it('refuses a config that checks nothing', () => {
    // A verifier with no schema and no rules passes everything, which reads as
    // "verified" on the canvas while verifying nothing at all.
    expect(() => new VerifyPipe().validateConfig({})).toThrow(/checks nothing/);
  });
});

describe('routing a batch', () => {
  const rules = [{ field: 'title', op: 'notEmpty' as const }];

  it('splits good records from bad across the two ports', async () => {
    const ports = await new VerifyPipe().transform(
      batch([{ id: 1, title: 'ok' }, { id: 2, title: '' }]),
      contextFor({ rules }),
    );

    expect(ports.get('out')!.records.map((r) => r.id)).toEqual([1]);
    expect(ports.get('rejects')!.records.map((r) => r.id)).toEqual([2]);
  });

  it('attaches the verdict to both', async () => {
    const ports = await new VerifyPipe().transform(
      batch([{ id: 1, title: 'ok' }, { id: 2, title: '' }]),
      contextFor({ rules }),
    );

    // The rejected record carries *why*, so the dead-letter is diagnosable
    // rather than just a pile of rows that did not make it.
    expect(ports.get('out')!.records[0]!.verification).toMatchObject({ ok: true });
    expect(ports.get('rejects')!.records[0]!.verification).toMatchObject({
      ok: false,
      failures: [{ field: 'title', op: 'notEmpty' }],
    });
  });

  it('opens no rejects port when everything passed', async () => {
    const ports = await new VerifyPipe().transform(
      batch([{ id: 1, title: 'ok' }]),
      contextFor({ rules }),
    );

    // An empty batch on `rejects` would light up a dead-letter path that
    // nothing went down, and downstream would run for no records.
    expect(ports.has('rejects')).toBe(false);
    expect(ports.get('out')!.records).toHaveLength(1);
  });

  it('passes everything through when annotating', async () => {
    const ports = await new VerifyPipe().transform(
      batch([{ id: 1, title: '' }]),
      contextFor({ rules, onInvalid: 'annotate' }),
    );

    // Scored but not acted on — for turning a check on before trusting it.
    expect(ports.has('rejects')).toBe(false);
    expect(ports.get('out')!.records[0]!.verification).toMatchObject({ ok: false });
  });

  it('stops the run when told to fail', async () => {
    await expect(
      new VerifyPipe().transform(
        batch([{ id: 1, title: '' }]),
        contextFor({ rules, onInvalid: 'fail' }),
      ),
    ).rejects.toThrow(/failed verification/);
  });
});
