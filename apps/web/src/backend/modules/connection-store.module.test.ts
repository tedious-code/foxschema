import { describe, it, expect, beforeAll } from 'vitest';

process.env.APP_DB_PATH = ':memory:';
process.env.APP_ENCRYPTION_KEY = '0'.repeat(64);

import { AuthModule } from './auth.module';
import { ConnectionStore } from './connection-store.module';
import { getStore } from '../database/store';
import { buildConnectionString } from '@foxschema/core';

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

  it('does not persist the password when savePassword is false', async () => {
    const created = await store.create(alice, { ...sample, savePassword: false });
    expect(created.hasPassword).toBe(false);
    const resolved = await store.resolve(alice, created.id);
    expect(resolved?.option.password).toBeUndefined();
    // other fields still saved
    expect(resolved?.option.host).toBe('db.example.com');
  });

  it('reports hasPassword true when the password is stored', async () => {
    const created = await store.create(alice, { ...sample, savePassword: true });
    expect(created.hasPassword).toBe(true);
  });

  it('update() preserves the existing password when the edit omits it', async () => {
    const id = (await store.create(alice, sample)).id;
    await store.update(alice, id, { ...sample, option: { ...sample.option, password: undefined } });
    expect((await store.resolve(alice, id))?.option.password).toBe('super-secret');
  });

  it('update() clears the stored password when savePassword is false', async () => {
    const id = (await store.create(alice, sample)).id;
    const updated = await store.update(alice, id, { ...sample, option: { ...sample.option, password: undefined }, savePassword: false });
    expect(updated?.hasPassword).toBe(false);
    expect((await store.resolve(alice, id))?.option.password).toBeUndefined();
  });

  // Regression: the real frontend (ConnectionModal.tsx) always pre-builds
  // connectionString from the typed form values BEFORE the save request is sent, and
  // for URL-style dialects that embeds the password directly (postgresql://user:pass@...).
  // create() must strip it from BOTH option.password AND option.connectionString when
  // the user opts out, or the secret survives in the encrypted blob regardless.
  it('does not leak the password via a pre-built connectionString when savePassword is false', async () => {
    const pgOption = { host: 'db.example.com', port: 5432, database: 'proddb', username: 'admin', password: 'super-secret' };
    const optionWithEmbeddedPassword = { ...pgOption, connectionString: buildConnectionString('postgres', pgOption) };
    expect(optionWithEmbeddedPassword.connectionString).toContain('super-secret');

    const created = await store.create(alice, {
      name: 'pg', dialect: 'postgres', schema: 'public', option: optionWithEmbeddedPassword, savePassword: false,
    });
    expect(created.hasPassword).toBe(false);

    const resolved = await store.resolve(alice, created.id);
    expect(resolved?.option.password).toBeUndefined();
    expect(resolved?.option.connectionString).not.toContain('super-secret');

    // the raw encrypted column must not contain the secret in any form either
    const db = await getStore();
    const rows = await db.all<{ encrypted_config: string }>('SELECT encrypted_config FROM connections WHERE id = ?', [created.id]);
    for (const r of rows) expect(r.encrypted_config).not.toContain('super-secret');
  });

  it('update() also strips a leaked password from a pre-built connectionString when opting out', async () => {
    const pgOption = { host: 'db.example.com', port: 5432, database: 'proddb', username: 'admin', password: 'super-secret' };
    const id = (await store.create(alice, { name: 'pg', dialect: 'postgres', schema: 'public', option: pgOption, savePassword: true })).id;

    const newOption = { ...pgOption, password: 'new-secret' };
    const optionWithEmbeddedPassword = { ...newOption, connectionString: buildConnectionString('postgres', newOption) };
    expect(optionWithEmbeddedPassword.connectionString).toContain('new-secret');

    const updated = await store.update(alice, id, {
      name: 'pg', dialect: 'postgres', schema: 'public', option: optionWithEmbeddedPassword, savePassword: false,
    });
    expect(updated?.hasPassword).toBe(false);

    const resolved = await store.resolve(alice, id);
    expect(resolved?.option.password).toBeUndefined();
    expect(resolved?.option.connectionString).not.toContain('new-secret');
    expect(resolved?.option.connectionString).not.toContain('super-secret');
  });

  it('still produces a correct, usable connectionString when the password IS kept', async () => {
    // Sanity check that discarding + rebuilding connectionString doesn't break the
    // normal case — the rebuilt string must still round-trip the kept password.
    const pgOption = { host: 'db.example.com', port: 5432, database: 'proddb', username: 'admin', password: 'super-secret' };
    const created = await store.create(alice, {
      name: 'pg', dialect: 'postgres', schema: 'public',
      option: { ...pgOption, connectionString: 'this-stale-value-should-be-discarded' },
      savePassword: true,
    });
    expect(created.hasPassword).toBe(true);

    const resolved = await store.resolve(alice, created.id);
    expect(resolved?.option.password).toBe('super-secret');
    expect(resolved?.option.connectionString).toBe(buildConnectionString('postgres', pgOption));
  });
});
