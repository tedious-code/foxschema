import { describe, expect, it } from 'vitest';
import type { RunEvent } from '../api/engineClient';
import { applyPipeEvent, type DebugPipeState } from './useDebugSamples';

const event = (type: string, data: Record<string, unknown>, message?: string) =>
  ({
    seq: 1,
    workflowRunId: 'r',
    at: '2026-01-01T00:00:00Z',
    pipelineId: 'p',
    pipeId: 'x',
    type,
    data,
    ...(message ? { message } : {}),
  }) as unknown as RunEvent;

describe('applyPipeEvent', () => {
  it('takes the status a pipe.status event announces', () => {
    const next = applyPipeEvent({}, 'k', event('pipe.status', { status: 'running' }));
    expect(next.k).toEqual({ status: 'running', processedBatches: 0, processedRecords: 0 });
  });

  // The engine reports a transform's or sink's finished batch only as
  // batch.progress with status 'success' — it sends no pipe.status for it.
  it('marks a transform successful from its batch.progress event', () => {
    let state: Record<string, DebugPipeState> = {};
    state = applyPipeEvent(state, 'k', event('pipe.status', { status: 'running' }));
    state = applyPipeEvent(state, 'k', event('batch.progress', { status: 'success', records: 4 }));
    expect(state.k).toEqual({ status: 'success', processedBatches: 1, processedRecords: 4 });
  });

  it('counts a source batch without changing a status it does not carry', () => {
    let state: Record<string, DebugPipeState> = {};
    state = applyPipeEvent(state, 'k', event('pipe.status', { status: 'running' }));
    state = applyPipeEvent(state, 'k', event('batch.progress', { records: 2 }));
    state = applyPipeEvent(state, 'k', event('batch.progress', { records: 3 }));
    expect(state.k).toEqual({ status: 'running', processedBatches: 2, processedRecords: 5 });
  });

  it('keeps the error a failed pipe reported', () => {
    let state: Record<string, DebugPipeState> = {};
    state = applyPipeEvent(state, 'k', event('pipe.status', { status: 'failed' }, 'boom'));
    expect(state.k?.error).toBe('boom');
    expect(state.k?.status).toBe('failed');
  });

  it('ignores events that are not about pipe state', () => {
    const state = { k: { status: 'running', processedBatches: 0, processedRecords: 0 } };
    expect(applyPipeEvent(state, 'k', event('batch.sample', {}))).toBe(state);
  });
});
