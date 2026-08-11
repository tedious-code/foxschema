import { describe, expect, it } from 'vitest';
import { isCellDoneMessage, isCellQueryRequest } from './code-cell-bridge';

describe('code-cell-bridge message guards', () => {
  it('accepts a minimal cell-query and optional Server Beam fields', () => {
    expect(
      isCellQueryRequest({
        type: 'cell-query',
        id: 1,
        text: 'SELECT 1',
        params: [],
        token: 'tok',
      })
    ).toBe(true);
    expect(
      isCellQueryRequest({
        type: 'cell-query',
        id: 2,
        text: 'SELECT 1',
        params: [1],
        token: 'tok',
        alias: 'source',
        viaOn: true,
      })
    ).toBe(true);
  });

  it('rejects malformed cell-query messages', () => {
    expect(isCellQueryRequest(null)).toBe(false);
    expect(isCellQueryRequest({ type: 'cell-done', result: [] })).toBe(false);
    expect(
      isCellQueryRequest({ type: 'cell-query', id: '1', text: 'SELECT 1', token: 'tok' })
    ).toBe(false);
    expect(isCellQueryRequest({ type: 'cell-query', id: 1, text: 1, token: 'tok' })).toBe(false);
    expect(
      isCellQueryRequest({ type: 'cell-query', id: 1, text: 'SELECT 1', token: 'tok', alias: 3 })
    ).toBe(false);
    expect(
      isCellQueryRequest({
        type: 'cell-query',
        id: 1,
        text: 'SELECT 1',
        token: 'tok',
        viaOn: 'yes',
      })
    ).toBe(false);
    // Missing / empty bridge token — forged parentPort posts must not validate.
    expect(isCellQueryRequest({ type: 'cell-query', id: 1, text: 'SELECT 1', params: [] })).toBe(
      false
    );
    expect(
      isCellQueryRequest({ type: 'cell-query', id: 1, text: 'SELECT 1', params: [], token: '' })
    ).toBe(false);
  });

  it('accepts cell-done and rejects non-objects', () => {
    expect(isCellDoneMessage({ type: 'cell-done', result: [{ n: 1 }] })).toBe(true);
    expect(isCellDoneMessage({ type: 'cell-query', id: 1, text: 'x' })).toBe(false);
    expect(isCellDoneMessage(null)).toBe(false);
  });
});
