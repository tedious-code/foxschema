import { getApiBase, parseJsonResponse } from '@/shared/api/apiBase';

export type DbEngine = 'sqlite' | 'postgres' | 'mysql';

/** Non-secret DB/security info for the settings screen. */
export interface AppInfo {
  db: { engine: string; location: string };
  security: { keyScheme: string; emailBound: boolean; boundEmail: string };
}

export async function fetchAppInfo(): Promise<AppInfo> {
  const res = await fetch(`${getApiBase()}/app-info`, { credentials: 'include' });
  return parseJsonResponse<AppInfo>(res);
}

/** Validate a candidate engine/URL (ops tooling / future settings). */
export async function testDbConnection(
  engine: DbEngine,
  url?: string,
  path?: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${getApiBase()}/db/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ engine, url, path }),
  });
  // Soft: UI shows error from body even when status is non-OK.
  try {
    return await parseJsonResponse<{ ok: boolean; error?: string }>(res);
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
