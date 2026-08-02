import { describe, expect, it } from 'vitest';
import {
  MAX_SERVERS,
  MAX_SQL,
  beamAliasesForCount,
  normalizeBeamAlias,
  parseBeamEndpoints,
  usesServerBeam,
} from './server-beam';

describe('server-beam', () => {
  it('exposes product caps', () => {
    expect(MAX_SERVERS).toBe(2);
    expect(MAX_SQL).toBe(20);
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
