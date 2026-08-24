import { describe, it, expect } from 'vitest';
import { parseCompareInput } from './compare.schema';
import { ServiceError } from '../../platform/contracts/actor';

const ref = { connectionId: 'c1' };

/**
 * `POST /compare {}` used to reach the service and surface as
 * `500 Cannot read properties of undefined (reading 'connectionId')` — a
 * caller's malformed request reported as a server fault.
 */
describe('parseCompareInput', () => {
  it('rejects a malformed body as invalid input, not a server error', () => {
    for (const body of [undefined, null, 'nope', 42, {}]) {
      const err = (() => { try { parseCompareInput(body); return null; } catch (e) { return e; } })();
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).status).toBe(400);
    }
  });

  it('names which side is missing', () => {
    expect(() => parseCompareInput({ target: ref })).toThrow(/source/);
    expect(() => parseCompareInput({ source: ref })).toThrow(/target/);
  });

  it('accepts a saved connection id on both sides', () => {
    const out = parseCompareInput({ source: ref, target: { connectionId: 'c2' } });
    expect(out.source).toEqual(ref);
    expect(out.scope).toEqual([]);
  });

  it('accepts an inline config, which is a valid reference too', () => {
    expect(() => parseCompareInput({ source: { config: { dialect: 'postgres' } }, target: ref })).not.toThrow();
  });

  it('treats an absent scope as everything', () => {
    // The UI sends no scope on a plain compare; rejecting it would break the
    // common path.
    expect(parseCompareInput({ source: ref, target: ref }).scope).toEqual([]);
  });

  it('rejects a scope that is not an array', () => {
    expect(() => parseCompareInput({ source: ref, target: ref, scope: 'TABLE' })).toThrow(/scope/);
  });

  it('passes a given scope through', () => {
    const out = parseCompareInput({ source: ref, target: ref, scope: ['TABLE', 'VIEW'] });
    expect(out.scope).toEqual(['TABLE', 'VIEW']);
  });
});
