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
