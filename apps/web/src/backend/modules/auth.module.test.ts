import { describe, it, expect, beforeAll } from 'vitest';

// Use an isolated in-memory DB before anything calls getStore()
process.env.APP_DB_PATH = ':memory:';

import { AuthModule } from './auth.module';
import { RbacModule } from './rbac.module';

const auth = new AuthModule();

describe('AuthModule', () => {
  beforeAll(async () => {
    // touch the DB so migrations run before tests
    await auth.getUserByToken('none');
  });

  it('registers and auto-creates a session', async () => {
    const { user, token } = await auth.register('Alice@Example.com', 'password123');
    expect(user.email).toBe('alice@example.com'); // normalized
    expect(user.onboardingCompleted).toBe(false);
    // First account on a fresh install is admin with full permissions.
    expect(user.role).toBe('admin');
    expect(user.permissions.length).toBeGreaterThan(0);
    expect((await auth.getUserByToken(token))?.id).toBe(user.id);
  });

  it('assigns viewer to subsequent registrations', async () => {
    const { user } = await auth.register('viewer2@example.com', 'password123');
    expect(user.role).toBe('viewer');
    expect(user.permissions).not.toContain('admin.users');
    expect(user.permissions).toContain('editor.run');
  });

  it('rejects a duplicate email', async () => {
    await auth.register('dup@example.com', 'password123');
    await expect(auth.register('dup@example.com', 'password123')).rejects.toThrow(/already exists/);
  });

  it('rejects weak passwords and bad emails', async () => {
    await expect(auth.register('a@b.com', 'short')).rejects.toThrow(/8 characters/);
    await expect(auth.register('not-an-email', 'password123')).rejects.toThrow(/valid email/);
  });

  it('logs in with correct credentials', async () => {
    await auth.register('bob@example.com', 'password123');
    const { user } = await auth.login('bob@example.com', 'password123');
    expect(user.email).toBe('bob@example.com');
  });

  it('rejects wrong password and unknown user the same way', async () => {
    await auth.register('carol@example.com', 'password123');
    await expect(auth.login('carol@example.com', 'wrongpass')).rejects.toThrow(/Invalid email or password/);
    await expect(auth.login('ghost@example.com', 'password123')).rejects.toThrow(/Invalid email or password/);
  });

  // Every auth path now selects app_role in its own query and passes it to
  // toAuthUser. Dropping that column anywhere fails silently as a demotion to
  // viewer, so pin the role across login and the per-request token lookup.
  it('preserves the stored role through login and getUserByToken', async () => {
    const { user: created } = await auth.register('editorrole@example.com', 'password123');
    await new RbacModule().setUserRole(created.id, 'editor');

    const { user, token } = await auth.login('editorrole@example.com', 'password123');
    expect(user.role).toBe('editor');
    // editor.write was split into the finer dml/ddl keys.
    expect(user.permissions).toContain('editor.dml');
    expect(user.permissions).toContain('editor.ddl');

    const resolved = await auth.getUserByToken(token);
    expect(resolved?.role).toBe('editor');
    expect(resolved?.permissions).toContain('editor.dml');
    expect(resolved?.permissions).not.toContain('admin.users');
  });

  it('ensureLocalUser returns an admin with full permissions', async () => {
    const local = await auth.ensureLocalUser();
    expect(local.role).toBe('admin');
    expect(local.permissions).toContain('admin.users');
    // Idempotent: a second call re-resolves the same singleton as admin.
    expect((await auth.ensureLocalUser()).id).toBe(local.id);
  });

  it('invalidates the session on logout', async () => {
    const { token } = await auth.register('dave@example.com', 'password123');
    expect(await auth.getUserByToken(token)).not.toBeNull();
    await auth.logout(token);
    expect(await auth.getUserByToken(token)).toBeNull();
  });
});
