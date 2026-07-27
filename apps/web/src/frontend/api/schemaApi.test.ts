import { describe, expect, it } from 'vitest';
import { cacheKeyForRef, nonSecretFingerprint, type ConnectionRef } from './schemaApi';

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
