import { describe, expect, it, afterAll } from 'vitest';
import { getProviderSettings, type ConnectionOptions } from '@foxschema/sql';
import { redisAdapter } from './redis/redis.adapter.js';
import { mongoDbAdapter } from './mongodb/mongodb.adapter.js';

/**
 * The settings are only useful if the string they build actually connects.
 * Unit-testing the URL shape proves the string, not the connection — so build
 * it the way the connection form does and hand it to the adapter.
 *
 *   FOX_REDIS_HOST=127.0.0.1 FOX_REDIS_PORT=6390 \
 *   FOX_MONGO_HOST=127.0.0.1 FOX_MONGO_PORT=27055 npx vitest run packages/db/src/providers/nosql-settings.it
 */
const redisHost = process.env.FOX_REDIS_HOST;
const mongoHost = process.env.FOX_MONGO_HOST;

describe.skipIf(!redisHost)('a form-built redis string connects', () => {
  afterAll(() => redisAdapter.closeAll());

  it('round-trips through buildConnectionString', async () => {
    const settings = getProviderSettings('redis');
    const option = {
      host: redisHost,
      port: Number(process.env.FOX_REDIS_PORT),
      schema: '0',
    } as ConnectionOptions;
    const url = settings.buildConnectionString(option);
    expect(url).toBe(`redis://${redisHost}:${process.env.FOX_REDIS_PORT}/0`);

    const conn = await redisAdapter.acquire(url, option, false);
    const table = `settingsit${Date.now()}`;
    await redisAdapter.query(conn, `INSERT INTO ${table} (id, v) VALUES (?, ?)`, ['1', 'ok']);
    const rows = await redisAdapter.query(conn, `SELECT * FROM ${table} WHERE id = ?`, ['1']);
    expect(rows[0]).toMatchObject({ id: '1', v: 'ok' });
    await redisAdapter.query(conn, `DELETE FROM ${table} WHERE id = ?`, ['1']);
  });
});

describe.skipIf(!mongoHost)('a form-built mongodb string connects', () => {
  afterAll(() => mongoDbAdapter.closeAll());

  it('round-trips through buildConnectionString', async () => {
    const settings = getProviderSettings('mongodb');
    const option = {
      host: mongoHost,
      port: Number(process.env.FOX_MONGO_PORT),
      database: 'foxsettings',
    } as ConnectionOptions;
    const url = settings.buildConnectionString(option);
    // No credentials supplied, so no authSource — which is what lets an
    // unauthenticated server accept this at all.
    expect(url).toBe(`mongodb://${mongoHost}:${process.env.FOX_MONGO_PORT}/foxsettings`);
    expect(url).not.toContain('authSource');

    const conn = await mongoDbAdapter.acquire(url, option, false);
    const table = `settingsit${Date.now()}`;
    await mongoDbAdapter.query(conn, `INSERT INTO ${table} (id, v) VALUES (?, ?)`, [1, 'ok']);
    const rows = await mongoDbAdapter.query(conn, `SELECT * FROM ${table} WHERE id = ?`, [1]);
    expect(rows[0]).toMatchObject({ id: 1, v: 'ok' });
    await conn.client.db(conn.database).collection(table).drop();
  });
});
