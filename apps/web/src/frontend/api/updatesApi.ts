import { getApiBase, parseJsonResponseOrNull } from './apiBase';

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
    return await parseJsonResponseOrNull<UpdateInfo>(res);
  } catch {
    return null;
  }
}
