import { describe, it, expect, beforeAll } from 'vitest';

// Use an isolated in-memory DB before anything calls getDb()
process.env.APP_DB_PATH = ':memory:';

import { AuthModule } from './auth.module';

const auth = new AuthModule();

describe('AuthModule', () => {
  beforeAll(() => {
    // touch the DB so migrations run before tests
    auth.getUserByToken('none');
  });

  it('registers and auto-creates a session', () => {
    const { user, token } = auth.register('Alice@Example.com', 'password123');
    expect(user.email).toBe('alice@example.com'); // normalized
    expect(user.onboardingCompleted).toBe(false);
    expect(auth.getUserByToken(token)?.id).toBe(user.id);
  });

  it('rejects a duplicate email', () => {
    auth.register('dup@example.com', 'password123');
    expect(() => auth.register('dup@example.com', 'password123')).toThrow(/already exists/);
  });

  it('rejects weak passwords and bad emails', () => {
    expect(() => auth.register('a@b.com', 'short')).toThrow(/8 characters/);
    expect(() => auth.register('not-an-email', 'password123')).toThrow(/valid email/);
  });

  it('logs in with correct credentials', () => {
    auth.register('bob@example.com', 'password123');
    const { user } = auth.login('bob@example.com', 'password123');
    expect(user.email).toBe('bob@example.com');
  });

  it('rejects wrong password and unknown user the same way', () => {
    auth.register('carol@example.com', 'password123');
    expect(() => auth.login('carol@example.com', 'wrongpass')).toThrow(/Invalid email or password/);
    expect(() => auth.login('ghost@example.com', 'password123')).toThrow(/Invalid email or password/);
  });

  it('invalidates the session on logout', () => {
    const { token } = auth.register('dave@example.com', 'password123');
    expect(auth.getUserByToken(token)).not.toBeNull();
    auth.logout(token);
    expect(auth.getUserByToken(token)).toBeNull();
  });
});
