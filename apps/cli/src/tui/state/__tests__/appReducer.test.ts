import { describe, it, expect } from 'vitest';
import { appReducer, initialState } from '../appReducer';
import type { Screen } from '../../types';

const HOME: Screen = { name: 'connectionPicker', role: 'source' };
const TARGET: Screen = { name: 'connectionPicker', role: 'target' };
const HISTORY: Screen = { name: 'historyList' };

describe('appReducer', () => {
  it('starts with a single-screen stack', () => {
    expect(initialState(HOME)).toEqual({ stack: [HOME] });
  });

  it('PUSH appends to the top of the stack', () => {
    const s1 = initialState(HOME);
    const s2 = appReducer(s1, { type: 'PUSH', screen: TARGET });
    expect(s2.stack).toEqual([HOME, TARGET]);
  });

  it('POP removes the top screen', () => {
    const s1 = { stack: [HOME, TARGET, HISTORY] };
    const s2 = appReducer(s1, { type: 'POP' });
    expect(s2.stack).toEqual([HOME, TARGET]);
  });

  it('POP is a no-op at depth 1 (nowhere to go back to)', () => {
    const s1 = initialState(HOME);
    const s2 = appReducer(s1, { type: 'POP' });
    expect(s2).toBe(s1);
  });

  it('RESET replaces the whole stack with a single screen', () => {
    const s1 = { stack: [HOME, TARGET, HISTORY] };
    const s2 = appReducer(s1, { type: 'RESET', screen: HOME });
    expect(s2.stack).toEqual([HOME]);
  });

  it('PUSH then POP returns to the exact prior screen (round-trip)', () => {
    const s1 = initialState(HOME);
    const s2 = appReducer(s1, { type: 'PUSH', screen: TARGET });
    const s3 = appReducer(s2, { type: 'POP' });
    expect(s3.stack).toEqual([HOME]);
  });
});
