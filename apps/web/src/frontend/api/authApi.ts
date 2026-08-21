/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { getApiBase, parseJsonResponse } from './apiBase';
import type { AppRole, Permission, PermissionMeta } from '../lib/permissions';

export interface AuthUser {
  id: string;
  email: string;
  onboardingCompleted: boolean;
  role: AppRole;
  permissions: Permission[];
}

export interface UserPreferences {
  role?: string;
  primaryDatabase?: string;
  primaryGoal?: string;
  theme?: string;
  onboardingCompleted: boolean;
}

export interface AppConfig {
  localSingleUser: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return parseJsonResponse<T>(res, { allowEmpty: true });
}

/** Public SPA boot config (login required?). */
export async function apiAppConfig(): Promise<AppConfig> {
  try {
    return await request<AppConfig>('/config');
  } catch {
    return { localSingleUser: true };
  }
}

/** Current session, or null if not signed in. */
export async function apiMe(): Promise<AuthUser | null> {
  try {
    const { user } = await request<{ user: AuthUser }>('/auth/me');
    return user;
  } catch {
    return null;
  }
}

export async function apiRegister(email: string, password: string): Promise<AuthUser> {
  const { user } = await request<{ user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return user;
}

export async function apiLogin(email: string, password: string): Promise<AuthUser> {
  const { user } = await request<{ user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return user;
}

export async function apiLogout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

export async function apiGetPreferences(): Promise<UserPreferences> {
  const { preferences } = await request<{ preferences: UserPreferences }>('/user/preferences');
  return preferences;
}

export async function apiPutPreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
  const { preferences } = await request<{ preferences: UserPreferences }>('/user/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
  return preferences;
}

export async function apiAdminListUsers(): Promise<{
  users: Array<{
    id: string;
    email: string;
    role: AppRole;
    active: boolean;
    createdAt: string;
    permissions: Permission[];
  }>;
}> {
  return request('/admin/users');
}

export async function apiAdminSetUserRole(userId: string, role: AppRole): Promise<void> {
  await request(`/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function apiAdminSetUserActive(userId: string, active: boolean): Promise<void> {
  await request(`/admin/users/${encodeURIComponent(userId)}/active`, {
    method: 'PUT',
    body: JSON.stringify({ active }),
  });
}

export async function apiAdminSetUserPassword(userId: string, password: string): Promise<void> {
  await request(`/admin/users/${encodeURIComponent(userId)}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
}

export async function apiAdminRolePermissions(): Promise<{
  matrix: Record<AppRole, Permission[]>;
  catalog: PermissionMeta[];
}> {
  return request('/admin/role-permissions');
}

export async function apiAdminSetRolePermissions(
  role: AppRole,
  permissions: Permission[]
): Promise<Permission[]> {
  const { permissions: next } = await request<{ role: AppRole; permissions: Permission[] }>(
    `/admin/role-permissions/${encodeURIComponent(role)}`,
    { method: 'PUT', body: JSON.stringify({ permissions }) }
  );
  return next;
}

// --- Saved connections (server-side, credentials encrypted at rest) ---------
export interface SavedConnectionSummary {
  id: string;
  name: string;
  dialect: string;
  schema?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  /** Whether a password is stored server-side (drives the "save password" checkbox on edit). */
  hasPassword?: boolean;
  createdAt: string;
}

export async function apiListConnections(): Promise<SavedConnectionSummary[]> {
  const { connections } = await request<{ connections: SavedConnectionSummary[] }>('/connections');
  return connections;
}

export async function apiCreateConnection(input: {
  name?: string;
  dialect: string;
  schema?: string;
  option: Record<string, unknown>;
  savePassword?: boolean;
}): Promise<SavedConnectionSummary> {
  const { connection } = await request<{ connection: SavedConnectionSummary }>('/connections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return connection;
}

export async function apiUpdateConnection(
  id: string,
  input: {
    name?: string;
    dialect: string;
    schema?: string;
    option: Record<string, unknown>;
    savePassword?: boolean;
  }
): Promise<SavedConnectionSummary> {
  const { connection } = await request<{ connection: SavedConnectionSummary }>(
    `/connections/${id}`,
    { method: 'PUT', body: JSON.stringify(input) }
  );
  return connection;
}

export async function apiDeleteConnection(id: string): Promise<void> {
  await request(`/connections/${id}`, { method: 'DELETE' });
}
