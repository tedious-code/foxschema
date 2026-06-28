import { getApiBase } from './apiBase';

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url?: string;
  notes?: string;
  configured: boolean;
}

/** Ask the server whether a newer app version is available. Null on failure. */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`${getApiBase()}/updates/check`, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as UpdateInfo;
  } catch {
    return null;
  }
}
