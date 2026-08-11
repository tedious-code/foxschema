import { describe, expect, it } from 'vitest';
import { PROVIDER_SETTINGS, buildConnectionString } from './provider-settings';

describe('nosql providers in credential form', () => {
  it('registers MongoDB and Redis for the dialect picker', () => {
    expect(PROVIDER_SETTINGS.mongodb?.label).toBe('MongoDB');
    expect(PROVIDER_SETTINGS.redis?.label).toBe('Redis');
  });

  it('builds the same Mongo URL shape as @foxschema/sql', () => {
    expect(
      buildConnectionString('mongodb', {
        host: 'h',
        port: 27017,
        database: 'shop',
        username: 'u',
        password: 'p',
      })
    ).toBe('mongodb://u:p@h:27017/shop?authSource=admin');
  });

  it('builds Redis URLs with numeric DB path and TLS scheme', () => {
    expect(buildConnectionString('redis', { host: 'h', schema: '3' })).toBe('redis://h:6379/3');
    expect(buildConnectionString('redis', { host: 'h', ssl: { enabled: true } })).toBe('rediss://h:6379');
  });
});
