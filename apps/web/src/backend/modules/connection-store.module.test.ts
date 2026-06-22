import { describe, it, expect, beforeAll } from 'vitest';

process.env.APP_DB_PATH = ':memory:';
process.env.APP_ENCRYPTION_KEY = '0'.repeat(64);

import { AuthModule } from './auth.module';
import { ConnectionStore } from './connection-store.module';
import { getStore } from '../database/store';

const auth = new AuthModule();
const store = new ConnectionStore();

let alice: string;
let bob: string;

beforeAll(async () => {
  alice = (await auth.register('alice@example.com', 'password123')).user.id;
  bob = (await auth.register('bob@example.com', 'password123')).user.id;
});

const sample = {
  name: 'prod',
  dialect: 'db2',
  schema: 'CARTER',
  option: { host: 'db.example.com', database: 'PRODDB', username: 'admin', password: 'super-secret' },
};

describe('ConnectionStore', () => {
  it('creates and lists a connection without exposing the password', async () => {
    await store.create(alice, sample);
    const list = await store.list(alice);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'prod', dialect: 'db2', host: 'db.example.com', database: 'PRODDB' });
    // summary must NOT carry credentials
    expect(JSON.stringify(list[0])).not.toContain('super-secret');
  });

  it('resolve() returns the decrypted option for server-side use', async () => {
    const id = (await store.create(alice, sample)).id;
    const resolved = await store.resolve(alice, id);
    expect(resolved?.option.password).toBe('super-secret');
    expect(resolved?.dialect).toBe('db2');
  });

  it('isolates connections per user', async () => {
    const id = (await store.create(alice, sample)).id;
    expect(await store.resolve(bob, id)).toBeNull(); // can't read another user's
    expect(await store.remove(bob, id)).toBe(false); // can't delete another user's
    expect(await store.resolve(alice, id)).not.toBeNull(); // owner still can
  });

  it('removes a connection', async () => {
    const id = (await store.create(alice, sample)).id;
    expect(await store.remove(alice, id)).toBe(true);
    expect(await store.resolve(alice, id)).toBeNull();
  });

  it('stores the config encrypted at rest (not plaintext)', async () => {
    await store.create(bob, sample);
    // peek at the raw column — the password must not appear in cleartext
    const db = await getStore();
    const rows = await db.all<{ encrypted_config: string }>('SELECT encrypted_config FROM connections');
    for (const r of rows) expect(r.encrypted_config).not.toContain('super-secret');
  });
});
