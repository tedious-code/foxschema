import { getApiBase } from './apiBase';

export interface AuthUser {
  id: string;
  email: string;
  onboardingCompleted: boolean;
}

export interface UserPreferences {
  role?: string;
  primaryDatabase?: string;
  primaryGoal?: string;
  theme?: string;
  onboardingCompleted: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data;
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
  input: { name?: string; dialect: string; schema?: string; option: Record<string, unknown>; savePassword?: boolean }
): Promise<SavedConnectionSummary> {
  const { connection } = await request<{ connection: SavedConnectionSummary }>(`/connections/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return connection;
}

export async function apiDeleteConnection(id: string): Promise<void> {
  await request(`/connections/${id}`, { method: 'DELETE' });
}
