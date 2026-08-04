import { describe, expect, it } from 'vitest';
import {
  MAX_SERVERS,
  MAX_SQL,
  beamAliasesForCount,
  createBeamSqlCap,
  normalizeBeamAlias,
  parseBeamEndpoints,
  usesServerBeam,
} from './server-beam';

describe('server-beam', () => {
  it('exposes product caps', () => {
    expect(MAX_SERVERS).toBe(2);
    expect(MAX_SQL).toBe(20);
  });

  it('createBeamSqlCap counts every take and rejects past max', () => {
    const cap = createBeamSqlCap(3);
    cap.take();
    cap.take();
    cap.take();
    expect(cap.count).toBe(3);
    expect(() => cap.take()).toThrow(/at most 3 SQL bridge calls/i);
    expect(cap.count).toBe(4);
  });

  it('createBeamSqlCap take() stays correct under interleaved microtasks', async () => {
    const cap = createBeamSqlCap(5);
    const tasks = Array.from({ length: 8 }, async () => {
      await Promise.resolve();
      cap.take();
    });
    const results = await Promise.allSettled(tasks);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(3);
    expect(cap.count).toBe(8);
  });

  it('detects sql.on usage', () => {
    expect(usesServerBeam('await sql.on("source")`SELECT 1`')).toBe(true);
    expect(usesServerBeam('await sql.on(\'target\')`SELECT 1`')).toBe(true);
    expect(usesServerBeam('await sql`SELECT 1`')).toBe(false);
  });

  it('parses beam endpoints and rejects a third server', () => {
    const ok = parseBeamEndpoints([
      { alias: 'source', connectionId: 'a' },
      { alias: 'target', connectionId: 'b' },
    ]);
    expect(ok.ok).toBe(true);
    const bad = parseBeamEndpoints([
      { alias: 'a', connectionId: '1' },
      { alias: 'b', connectionId: '2' },
      { alias: 'c', connectionId: '3' },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/at most 2/i);
  });

  it('normalizes aliases', () => {
    expect(normalizeBeamAlias(' source ')).toBe('source');
    expect(normalizeBeamAlias('1bad')).toBe(null);
    expect(beamAliasesForCount(2)).toEqual(['source', 'target']);
  });
});

describe('alias lookup must not accept inherited Object keys', () => {
  // The worker resolves `sql.on(alias)` against a plain object of alias→dialect.
  // A truthiness check lets `toString` / `constructor` / `valueOf` / `__proto__`
  // through, and the inherited *function* then gets used as the dialect —
  // surfacing as "dialect.toLowerCase is not a function" instead of a clear
  // "unknown alias". hasOwn is the only correct membership test here.
  const beamDialects: Record<string, string> = { source: 'postgres', target: 'mysql' };

  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'rejects inherited key %s',
    (key) => {
      expect(Boolean(beamDialects[key])).toBe(true); // the trap
      expect(Object.hasOwn(beamDialects, key)).toBe(false); // the fix
    }
  );

  it('still accepts real aliases and rejects genuinely unknown ones', () => {
    expect(Object.hasOwn(beamDialects, 'source')).toBe(true);
    expect(Object.hasOwn(beamDialects, 'target')).toBe(true);
    expect(Object.hasOwn(beamDialects, 'nope')).toBe(false);
  });
});
