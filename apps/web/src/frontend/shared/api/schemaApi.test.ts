import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  cacheKeyForRef,
  fetchDbAccess,
  invalidateCache,
  invalidateDbAccessCache,
  matchIndexFragmentationRow,
  nonSecretFingerprint,
  type ConnectionRef,
} from './schemaApi';

describe('matchIndexFragmentationRow', () => {
  const rows = [
    { indexName: 'IX_Orders_Customer', fragmentationPercent: 12.5, pageCount: 9 },
    { indexName: 'dbo.IX_Orders_Status', fragmentationPercent: 40, pageCount: 3 },
  ];

  it('matches exact and case-insensitive names', () => {
    expect(matchIndexFragmentationRow('IX_Orders_Customer', rows)?.fragmentationPercent).toBe(
      12.5
    );
    expect(matchIndexFragmentationRow('ix_orders_customer', rows)?.fragmentationPercent).toBe(
      12.5
    );
  });

  it('matches schema-qualified probe names to bare catalog names', () => {
    expect(matchIndexFragmentationRow('IX_Orders_Status', rows)?.fragmentationPercent).toBe(40);
    expect(matchIndexFragmentationRow('dbo.IX_Orders_Status', rows)?.fragmentationPercent).toBe(
      40
    );
  });

  it('returns null when nothing matches', () => {
    expect(matchIndexFragmentationRow('missing', rows)).toBeNull();
    expect(matchIndexFragmentationRow('', rows)).toBeNull();
  });
});

describe('cacheKeyForRef', () => {
  it('uses connectionId plus schema and password fingerprint', () => {
    const key = cacheKeyForRef({
      connectionId: 'conn-1',
      schema: 'demo_a',
      password: 'secret',
      option: { connectionString: 'postgres://u:secret@h/db', password: 'secret' },
    });
    expect(key.startsWith('id:conn-1|')).toBe(true);
    expect(key).toContain('schema:demo_a');
    expect(key).toContain(`pw:${nonSecretFingerprint('secret')}`);
    expect(key).not.toContain('secret');
    expect(key).not.toContain('postgres://');
  });

  it('differs when schema or session password changes for the same connectionId', () => {
    const base = { connectionId: 'conn-1' };
    const a = cacheKeyForRef({ ...base, schema: 'demo_a', password: 'p1' });
    const b = cacheKeyForRef({ ...base, schema: 'demo_b', password: 'p1' });
    const c = cacheKeyForRef({ ...base, schema: 'demo_a', password: 'p2' });
    const d = cacheKeyForRef({ ...base, schema: 'demo_a' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it('never embeds password or connectionString plaintext', () => {
    const ref: ConnectionRef = {
      dialect: 'postgres',
      password: 'super-secret-pw',
      schema: 'public',
      option: {
        host: 'db.example.com',
        port: 5432,
        database: 'app',
        username: 'appuser',
        password: 'super-secret-pw',
        connectionString: 'postgres://appuser:super-secret-pw@db.example.com:5432/app',
      },
    };
    const key = cacheKeyForRef(ref);
    expect(key).not.toContain('super-secret-pw');
    expect(key).not.toContain('postgres://');
    expect(key).not.toContain('connectionString');
    expect(key).toContain('postgres');
    expect(key).toContain('db.example.com');
    expect(key).toContain('appuser');
  });

  it('distinguishes ad-hoc sqlite paths that only differ in connectionString', () => {
    const a = cacheKeyForRef({
      dialect: 'sqlite',
      option: { connectionString: '/tmp/a.db' },
    });
    const b = cacheKeyForRef({
      dialect: 'sqlite',
      option: { connectionString: '/tmp/b.db' },
    });
    expect(a).not.toBe(b);
  });
});

describe('fetchDbAccess session cache', () => {
  afterEach(() => {
    invalidateCache();
    vi.unstubAllGlobals();
  });

  function okAccess(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('collapses duplicate catalog probes for the same connection and schema', async () => {
    const fetchMock = vi.fn(async () =>
      okAccess({ principals: [{ name: 'alice' }], privileges: [] })
    );
    vi.stubGlobal('fetch', fetchMock);
    const ref = { connectionId: 'c1' };
    const [a, b] = await Promise.all([
      fetchDbAccess(ref, { schema: 'public' }),
      fetchDbAccess(ref, { schema: 'public' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.principals?.[0]?.name).toBe('alice');
    expect(b).toBe(a);
    await fetchDbAccess(ref, { schema: 'public' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after invalidateDbAccessCache', async () => {
    const fetchMock = vi.fn(async () =>
      okAccess({ principals: [{ name: 'bob' }], privileges: [] })
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchDbAccess({ connectionId: 'c1' }, { schema: 'public' });
    invalidateDbAccessCache('c1');
    await fetchDbAccess({ connectionId: 'c1' }, { schema: 'public' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
