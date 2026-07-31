import { describe, it, expect, afterEach } from 'vitest';
import { createMetadataStore } from './stores/registry';
import { runMigrations } from './schema';
import type { MetadataStore } from './stores/types';

/**
 * Upgrade vs greenfield behavior for the first-open email wizard.
 * Greenfield: all migrations in one pass → wizard may show.
 * Upgrade: migration 7 on a DB that already had earlier migrations → wizard suppressed.
 */
describe('runMigrations · signup wizard on upgrade', () => {
  let store: MetadataStore | null = null;

  afterEach(async () => {
    if (store) {
      await store.close().catch(() => undefined);
      store = null;
    }
  });

  async function openMemory(): Promise<MetadataStore> {
    const s = createMetadataStore({ engine: 'sqlite', path: ':memory:' });
    await s.init();
    store = s;
    return s;
  }

  async function wizardShown(s: MetadataStore): Promise<string | undefined> {
    const row = await s.get<{ value: string | null }>(
      'SELECT "value" FROM app_settings WHERE "key" = ?',
      ['signup.wizard_shown']
    );
    return row?.value ?? undefined;
  }

  it('greenfield install does not pre-mark the signup wizard as shown', async () => {
    const s = await openMemory();
    await runMigrations(s);
    expect(await wizardShown(s)).toBeUndefined();
  });

  it('upgrade applying rbac_app_roles suppresses the signup wizard', async () => {
    const s = await openMemory();
    // Simulate a pre-RBAC install: apply everything except migration 7+.
    await runMigrations(s);
    await s.run('DELETE FROM schema_migrations WHERE id >= ?', [7]);
    await s.exec('DROP TABLE IF EXISTS role_permissions');
    await s.run('DELETE FROM app_settings WHERE "key" = ?', ['signup.wizard_shown']);
    expect(await wizardShown(s)).toBeUndefined();

    await runMigrations(s);

    expect(await wizardShown(s)).toBe('true');
    const rbac = await s.get<{ id: number }>('SELECT id FROM schema_migrations WHERE id = ?', [7]);
    expect(rbac?.id).toBe(7);
  });

  it('migration 8 suppresses wizard when connections already exist', async () => {
    const s = await openMemory();
    await runMigrations(s);
    await s.run('DELETE FROM schema_migrations WHERE id = ?', [8]);
    await s.run('DELETE FROM app_settings WHERE "key" = ?', ['signup.wizard_shown']);
    // Minimal row so installLooksUsed() is true (columns match init migration).
    await s.run(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
      ['u1', 'owner@example.com', 'x', new Date().toISOString()]
    );
    await s.run(
      `INSERT INTO connections (id, user_id, name, dialect, encrypted_config, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['c1', 'u1', 'prod', 'sqlite', 'enc', new Date().toISOString()]
    );
    expect(await wizardShown(s)).toBeUndefined();

    await runMigrations(s);

    expect(await wizardShown(s)).toBe('true');
  });
});
