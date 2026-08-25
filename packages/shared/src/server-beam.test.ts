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

  it('createBeamSqlCap defaults to MAX_SQL', () => {
    const cap = createBeamSqlCap();
    for (let i = 0; i < MAX_SQL; i++) cap.take();
    expect(cap.count).toBe(MAX_SQL);
    expect(() => cap.take()).toThrow(new RegExp(`at most ${MAX_SQL} SQL bridge calls`, 'i'));
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
    expect(usesServerBeam("await sql.on('target')`SELECT 1`")).toBe(true);
    expect(usesServerBeam('await sql`SELECT 1`')).toBe(false);
    // Whitespace between sql / . / on is still Beam.
    expect(usesServerBeam('await sql  .  on ("source")`SELECT 1`')).toBe(true);
    // Nearby identifiers must not false-trigger.
    expect(usesServerBeam('const sqlOn = true; return [];')).toBe(false);
    expect(usesServerBeam('await sql.one`SELECT 1`')).toBe(false);
  });

  it('parses beam endpoints and rejects a third server', () => {
    const ok = parseBeamEndpoints([
      { alias: 'source', connectionId: 'a' },
      { alias: 'target', connectionId: 'b' },
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value).toEqual([
        { alias: 'source', connectionId: 'a' },
        { alias: 'target', connectionId: 'b' },
      ]);
    }
    const bad = parseBeamEndpoints([
      { alias: 'a', connectionId: '1' },
      { alias: 'b', connectionId: '2' },
      { alias: 'c', connectionId: '3' },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/at most 2/i);
  });

  it('parseBeamEndpoints accepts null/undefined as empty', () => {
    expect(parseBeamEndpoints(null)).toEqual({ ok: true, value: [] });
    expect(parseBeamEndpoints(undefined)).toEqual({ ok: true, value: [] });
  });

  it('parseBeamEndpoints rejects non-arrays, bad entries, and duplicates', () => {
    expect(parseBeamEndpoints({ alias: 'source' }).ok).toBe(false);
    expect(parseBeamEndpoints(['source']).ok).toBe(false);
    expect(parseBeamEndpoints([{ alias: 'source' }]).ok).toBe(false);
    expect(parseBeamEndpoints([{ alias: 'source', connectionId: '  ' }]).ok).toBe(false);
    expect(parseBeamEndpoints([{ alias: '1bad', connectionId: 'a' }]).ok).toBe(false);
    expect(
      parseBeamEndpoints([
        { alias: 'source', connectionId: 'a' },
        { alias: 'source', connectionId: 'b' },
      ]).ok
    ).toBe(false);
  });

  it('parseBeamEndpoints trims connectionId and keeps session password', () => {
    const withPw = parseBeamEndpoints([
      { alias: ' source ', connectionId: '  conn-1  ', password: 's3cret' },
    ]);
    expect(withPw).toEqual({
      ok: true,
      value: [{ alias: 'source', connectionId: 'conn-1', password: 's3cret' }],
    });
    const emptyPw = parseBeamEndpoints([{ alias: 'source', connectionId: 'c', password: '' }]);
    expect(emptyPw).toEqual({
      ok: true,
      value: [{ alias: 'source', connectionId: 'c' }],
    });
  });

  it('normalizes aliases and Destination order mapping', () => {
    expect(normalizeBeamAlias(' source ')).toBe('source');
    expect(normalizeBeamAlias('1bad')).toBe(null);
    expect(normalizeBeamAlias('')).toBe(null);
    expect(normalizeBeamAlias(null)).toBe(null);
    expect(normalizeBeamAlias(12)).toBe(null);
    expect(normalizeBeamAlias('a'.repeat(64))).toBe('a'.repeat(64));
    expect(normalizeBeamAlias('a'.repeat(65))).toBe(null);
    expect(beamAliasesForCount(0)).toEqual([]);
    expect(beamAliasesForCount(1)).toEqual(['source']);
    expect(beamAliasesForCount(2)).toEqual(['source', 'target']);
    // UI clips to MAX_SERVERS before calling; helper still returns source/target.
    expect(beamAliasesForCount(99)).toEqual(['source', 'target']);
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
