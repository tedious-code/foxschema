import { describe, expect, it } from 'vitest';
import { cacheKeyForRef, type ConnectionRef } from './schemaApi';

describe('cacheKeyForRef', () => {
  it('uses connectionId when present', () => {
    expect(
      cacheKeyForRef({
        connectionId: 'conn-1',
        password: 'secret',
        option: { connectionString: 'postgres://u:secret@h/db', password: 'secret' },
      })
    ).toBe('id:conn-1');
  });

  it('never embeds password or connectionString', () => {
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
});
