import { describe, expect, it } from 'vitest';
import { isCellDoneMessage, isCellQueryRequest } from './code-cell-bridge';

describe('code-cell-bridge message guards', () => {
  it('accepts a minimal cell-query and optional Server Beam fields', () => {
    expect(
      isCellQueryRequest({ type: 'cell-query', id: 1, text: 'SELECT 1', params: [] })
    ).toBe(true);
    expect(
      isCellQueryRequest({
        type: 'cell-query',
        id: 2,
        text: 'SELECT 1',
        params: [1],
        alias: 'source',
        viaOn: true,
      })
    ).toBe(true);
  });

  it('rejects malformed cell-query messages', () => {
    expect(isCellQueryRequest(null)).toBe(false);
    expect(isCellQueryRequest({ type: 'cell-done', result: [] })).toBe(false);
    expect(isCellQueryRequest({ type: 'cell-query', id: '1', text: 'SELECT 1' })).toBe(false);
    expect(isCellQueryRequest({ type: 'cell-query', id: 1, text: 1 })).toBe(false);
    expect(
      isCellQueryRequest({ type: 'cell-query', id: 1, text: 'SELECT 1', alias: 3 })
    ).toBe(false);
    expect(
      isCellQueryRequest({ type: 'cell-query', id: 1, text: 'SELECT 1', viaOn: 'yes' })
    ).toBe(false);
  });

  it('accepts cell-done and rejects non-objects', () => {
    expect(isCellDoneMessage({ type: 'cell-done', result: [{ n: 1 }] })).toBe(true);
    expect(isCellDoneMessage({ type: 'cell-query', id: 1, text: 'x' })).toBe(false);
    expect(isCellDoneMessage(null)).toBe(false);
  });
});
