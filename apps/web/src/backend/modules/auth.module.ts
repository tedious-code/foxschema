/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { getStore } from '../database/store';
import { hashPassword, verifyPassword, newToken } from '../cores/crypto';
import { RbacModule, toAppRole } from './rbac.module';
import type { MetadataStore } from '../database/stores/types';
import type { AppRole, Permission } from '../../shared/permissions';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface AuthUser {
  id: string;
  email: string;
  onboardingCompleted: boolean;
  /** App RBAC role (admin | editor | viewer). */
  role: AppRole;
  /** Effective permissions for this user (from role grants). */
  permissions: Permission[];
}

function validateCredentials(email: string, password: string): void {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('A valid email is required.');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

/** The `users` columns every auth path resolves an AuthUser from. */
interface UserRow {
  id: string;
  email: string;
  onboarding_completed: number;
  app_role: string | null;
  active?: number | null;
}

function assertUserActive(row: UserRow): void {
  if (row.active === null || row.active === undefined) return;
  if (Number(row.active) === 0) {
    throw new Error('This account has been deactivated. Contact an administrator.');
  }
}

/** First account on the install becomes admin; later signups default to viewer. */
async function nextSignupRole(store: MetadataStore): Promise<AppRole> {
  const countRow = await store.get<{ n: number }>('SELECT COUNT(*) AS n FROM users');
  return Number(countRow?.n ?? 0) === 0 ? 'admin' : 'viewer';
}

export class AuthModule {
  private rbac = new RbacModule();

  private async toAuthUser(row: UserRow): Promise<AuthUser> {
    const role = toAppRole(row.app_role);
    return {
      id: row.id,
      email: row.email,
      onboardingCompleted: !!row.onboarding_completed,
      role,
      permissions: await this.rbac.permissionsForRole(role),
    };
  }

  /** Create an account and start a session (register auto-logs-in). */
  async register(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    validateCredentials(email, password);
    const store = await getStore();
    const normalized = email.trim().toLowerCase();

    const existing = await store.get('SELECT id FROM users WHERE email = ?', [normalized]);
    if (existing) throw new Error('An account with this email already exists.');

    const role = await nextSignupRole(store);
    const id = randomUUID();
    await store.run(
      'INSERT INTO users (id, email, password_hash, created_at, app_role) VALUES (?, ?, ?, ?, ?)',
      [id, normalized, hashPassword(password), new Date().toISOString(), role]
    );

    const user = await this.toAuthUser({
      id,
      email: normalized,
      onboarding_completed: 0,
      app_role: role,
    });
    return { user, token: await this.createSession(id) };
  }

  async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const store = await getStore();
    const normalized = (email ?? '').trim().toLowerCase();
    const row = await store.get<UserRow & { password_hash: string }>(
      'SELECT id, email, password_hash, onboarding_completed, app_role, active FROM users WHERE email = ?',
      [normalized]
    );

    // Same error whether the email or password is wrong (no account enumeration)
    if (!row || !verifyPassword(password ?? '', row.password_hash)) {
      throw new Error('Invalid email or password.');
    }
    assertUserActive(row);

    return { user: await this.toAuthUser(row), token: await this.createSession(row.id) };
  }

  /**
   * Admin sets another user's password (Access control). Invalidates their sessions.
   */
  async adminSetPassword(userId: string, password: string): Promise<void> {
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    const store = await getStore();
    const exists = await store.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!exists) throw new Error('User not found.');
    await store.run('UPDATE users SET password_hash = ? WHERE id = ?', [
      hashPassword(password),
      userId,
    ]);
    await store.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  /**
   * Log in via a verified external identity (SSO): find the user by email or
   * create a passwordless account, then start a session.
   */
  async loginWithEmail(email: string): Promise<{ user: AuthUser; token: string }> {
    const store = await getStore();
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized.includes('@')) throw new Error('SSO did not return a valid email.');
    let row = await store.get<UserRow>(
      'SELECT id, email, onboarding_completed, app_role, active FROM users WHERE email = ?',
      [normalized]
    );
    if (!row) {
      const role = await nextSignupRole(store);
      const id = randomUUID();
      await store.run(
        'INSERT INTO users (id, email, password_hash, created_at, app_role) VALUES (?, ?, ?, ?, ?)',
        [id, normalized, hashPassword(randomUUID()), new Date().toISOString(), role]
      );
      row = { id, email: normalized, onboarding_completed: 0, app_role: role, active: 1 };
    }
    assertUserActive(row);
    return { user: await this.toAuthUser(row), token: await this.createSession(row.id) };
  }

  /**
   * Local single-user mode: return the singleton local user (always admin).
   */
  async ensureLocalUser(): Promise<AuthUser> {
    const store = await getStore();
    const boundEmail = (process.env.APP_USER_EMAIL || '').trim().toLowerCase();
    const email = boundEmail || 'local@foxschema.app';
    const find = (e: string) =>
      store.get<UserRow>(
        'SELECT id, email, onboarding_completed, app_role, active FROM users WHERE email = ?',
        [e]
      );
    const existing =
      (await find(email)) || (boundEmail ? await find('local@foxschema.app') : undefined);
    if (existing) {
      if (existing.app_role !== 'admin') {
        await store.run("UPDATE users SET app_role = 'admin' WHERE id = ?", [existing.id]);
      }
      // Local singleton stays usable even if accidentally deactivated in Access UI.
      if (existing.active === 0) {
        await store.run('UPDATE users SET active = 1 WHERE id = ?', [existing.id]);
      }
      return this.toAuthUser({ ...existing, app_role: 'admin', active: 1 });
    }
    const id = randomUUID();
    await store.run(
      'INSERT INTO users (id, email, password_hash, created_at, app_role) VALUES (?, ?, ?, ?, ?)',
      [id, email, hashPassword(randomUUID()), new Date().toISOString(), 'admin']
    );
    return this.toAuthUser({ id, email, onboarding_completed: 0, app_role: 'admin' });
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

    const user = await store.get<UserRow>(
      'SELECT id, email, onboarding_completed, app_role, active FROM users WHERE id = ?',
      [session.user_id]
    );
    if (!user) return null;
    if (user.active !== null && user.active !== undefined && Number(user.active) === 0) {
      await store.run('DELETE FROM sessions WHERE token = ?', [token]);
      return null;
    }

    return this.toAuthUser(user);
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
