import { randomUUID } from 'node:crypto';
import { getDb } from '../database/sqlite';
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
  register(email: string, password: string): { user: AuthUser; token: string } {
    validateCredentials(email, password);
    const db = getDb();
    const normalized = email.trim().toLowerCase();

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
    if (existing) throw new Error('An account with this email already exists.');

    const id = randomUUID();
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      normalized,
      hashPassword(password),
      new Date().toISOString()
    );

    return { user: { id, email: normalized, onboardingCompleted: false }, token: this.createSession(id) };
  }

  login(email: string, password: string): { user: AuthUser; token: string } {
    const db = getDb();
    const normalized = (email ?? '').trim().toLowerCase();
    const row = db
      .prepare('SELECT id, email, password_hash, onboarding_completed FROM users WHERE email = ?')
      .get(normalized) as { id: string; email: string; password_hash: string; onboarding_completed: number } | undefined;

    // Same error whether the email or password is wrong (no account enumeration)
    if (!row || !verifyPassword(password ?? '', row.password_hash)) {
      throw new Error('Invalid email or password.');
    }

    return {
      user: { id: row.id, email: row.email, onboardingCompleted: !!row.onboarding_completed },
      token: this.createSession(row.id),
    };
  }

  /**
   * Local single-user mode (community desktop): return the singleton local
   * user, creating it on first call. There is no password login — the desktop
   * app itself is the authenticated boundary, so the stored hash is random and
   * unusable.
   */
  ensureLocalUser(): AuthUser {
    const db = getDb();
    const email = 'local@foxschema.app';
    const existing = db
      .prepare('SELECT id, email, onboarding_completed FROM users WHERE email = ?')
      .get(email) as { id: string; email: string; onboarding_completed: number } | undefined;
    if (existing) {
      return { id: existing.id, email: existing.email, onboardingCompleted: !!existing.onboarding_completed };
    }
    const id = randomUUID();
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      email,
      hashPassword(randomUUID()),
      new Date().toISOString()
    );
    return { id, email, onboardingCompleted: false };
  }

  logout(token: string | undefined): void {
    if (!token) return;
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  /** Resolve a session token to its user, or null if missing/expired. */
  getUserByToken(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const db = getDb();
    const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as
      | { user_id: string; expires_at: string }
      | undefined;
    if (!session) return null;

    if (new Date(session.expires_at).getTime() < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }

    const user = db
      .prepare('SELECT id, email, onboarding_completed FROM users WHERE id = ?')
      .get(session.user_id) as { id: string; email: string; onboarding_completed: number } | undefined;
    if (!user) return null;

    return { id: user.id, email: user.email, onboardingCompleted: !!user.onboarding_completed };
  }

  private createSession(userId: string): string {
    const token = newToken();
    const now = Date.now();
    getDb()
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
    return token;
  }
}

export const SESSION_COOKIE = 'sid';
export const SESSION_MAX_AGE_MS = SESSION_TTL_MS;
