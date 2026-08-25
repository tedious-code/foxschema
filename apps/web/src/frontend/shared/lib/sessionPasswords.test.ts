import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSessionPassword,
  getSessionPassword,
  resetSessionPasswordsForTests,
  sessionPasswordMap,
  setSessionPassword,
} from './sessionPasswords';

afterEach(() => {
  resetSessionPasswordsForTests();
});

describe('sessionPasswords', () => {
  it('stores and returns a session password', () => {
    setSessionPassword('c1', 'secret');
    expect(getSessionPassword('c1')).toBe('secret');
    expect(sessionPasswordMap()).toEqual({ c1: 'secret' });
  });

  it('clears on empty set or explicit clear', () => {
    setSessionPassword('c1', 'secret');
    setSessionPassword('c1', '');
    expect(getSessionPassword('c1')).toBeUndefined();
    setSessionPassword('c1', 'again');
    clearSessionPassword('c1');
    expect(getSessionPassword('c1')).toBeUndefined();
  });
});
