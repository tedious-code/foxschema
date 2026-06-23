import { randomUUID } from 'node:crypto';
import { getStore } from '../database/store';
import { hashPassword, verifyPassword, newToken } from '../cores/crypto';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface AuthUser {
  id: string;
  email: string;
  onboardingCompleted: boolean;
}

function validateCredentials(email: string, password: string): void {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('A valid email is required.');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

export class AuthModule {
  /** Create an account and start a session (register auto-logs-in). */
  async register(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    validateCredentials(email, password);
    const store = await getStore();
    const normalized = email.trim().toLowerCase();

    const existing = await store.get('SELECT id FROM users WHERE email = ?', [normalized]);
    if (existing) throw new Error('An account with this email already exists.');

    const id = randomUUID();
    await store.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
      id,
      normalized,
      hashPassword(password),
      new Date().toISOString(),
    ]);

    return { user: { id, email: normalized, onboardingCompleted: false }, token: await this.createSession(id) };
  }

  async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const store = await getStore();
    const normalized = (email ?? '').trim().toLowerCase();
    const row = await store.get<{ id: string; email: string; password_hash: string; onboarding_completed: number }>(
      'SELECT id, email, password_hash, onboarding_completed FROM users WHERE email = ?',
      [normalized]
    );

    // Same error whether the email or password is wrong (no account enumeration)
    if (!row || !verifyPassword(password ?? '', row.password_hash)) {
      throw new Error('Invalid email or password.');
    }

    return {
      user: { id: row.id, email: row.email, onboardingCompleted: !!row.onboarding_completed },
      token: await this.createSession(row.id),
    };
  }

  /**
   * Local single-user mode (community desktop): return the singleton local
   * user, creating it on first call. There is no password login — the desktop
   * app itself is the authenticated boundary, so the stored hash is random and
   * unusable.
   */
  /**
   * Log in via a verified external identity (SSO): find the user by email or
   * create a passwordless account, then start a session. The provider has
   * already verified the email, so there's no password check.
   */
  async loginWithEmail(email: string): Promise<{ user: AuthUser; token: string }> {
    const store = await getStore();
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized.includes('@')) throw new Error('SSO did not return a valid email.');
    let row = await store.get<{ id: string; email: string; onboarding_completed: number }>(
      'SELECT id, email, onboarding_completed FROM users WHERE email = ?',
      [normalized]
    );
    if (!row) {
      const id = randomUUID();
      await store.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
        id,
        normalized,
        hashPassword(randomUUID()), // unusable password — SSO-only account
        new Date().toISOString(),
      ]);
      row = { id, email: normalized, onboarding_completed: 0 };
    }
    return {
      user: { id: row.id, email: row.email, onboardingCompleted: !!row.onboarding_completed },
      token: await this.createSession(row.id),
    };
  }

  async ensureLocalUser(): Promise<AuthUser> {
    const store = await getStore();
    // The bound email from the one-time setup (key is derived from it); falls
    // back to the legacy default for installs created before setup existed.
    const boundEmail = (process.env.APP_USER_EMAIL || '').trim().toLowerCase();
    const email = boundEmail || 'local@foxschema.app';
    const find = (e: string) =>
      store.get<{ id: string; email: string; onboarding_completed: number }>(
        'SELECT id, email, onboarding_completed FROM users WHERE email = ?',
        [e]
      );
    // Prefer an existing user (bound email, then legacy) so a migrated install
    // keeps its data instead of orphaning connections under a new user row.
    const existing = (await find(email)) || (boundEmail ? await find('local@foxschema.app') : undefined);
    if (existing) {
      return { id: existing.id, email: existing.email, onboardingCompleted: !!existing.onboarding_completed };
    }
    const id = randomUUID();
    await store.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
      id,
      email,
      hashPassword(randomUUID()),
      new Date().toISOString(),
    ]);
    return { id, email, onboardingCompleted: false };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const store = await getStore();
    await store.run('DELETE FROM sessions WHERE token = ?', [token]);
  }

  /** Resolve a session token to its user, or null if missing/expired. */
  async getUserByToken(token: string | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const store = await getStore();
    const session = await store.get<{ user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM sessions WHERE token = ?',
      [token]
    );
    if (!session) return null;

    if (new Date(session.expires_at).getTime() < Date.now()) {
      await store.run('DELETE FROM sessions WHERE token = ?', [token]);
      return null;
    }

    const user = await store.get<{ id: string; email: string; onboarding_completed: number }>(
      'SELECT id, email, onboarding_completed FROM users WHERE id = ?',
      [session.user_id]
    );
    if (!user) return null;

    return { id: user.id, email: user.email, onboardingCompleted: !!user.onboarding_completed };
  }

  private async createSession(userId: string): Promise<string> {
    const token = newToken();
    const now = Date.now();
    const store = await getStore();
    await store.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      token,
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_MS).toISOString(),
    ]);
    return token;
  }
}

export const SESSION_COOKIE = 'sid';
export const SESSION_MAX_AGE_MS = SESSION_TTL_MS;
