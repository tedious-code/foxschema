import { describe, it, expect, beforeAll } from 'vitest';

// Use an isolated in-memory DB before anything calls getStore()
process.env.APP_DB_PATH = ':memory:';

import { AuthModule } from './auth.module';

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
    expect((await auth.getUserByToken(token))?.id).toBe(user.id);
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

  it('invalidates the session on logout', async () => {
    const { token } = await auth.register('dave@example.com', 'password123');
    expect(await auth.getUserByToken(token)).not.toBeNull();
    await auth.logout(token);
    expect(await auth.getUserByToken(token)).toBeNull();
  });
});
