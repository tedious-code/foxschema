import { getApiBase, parseJsonResponseOrNull } from './apiBase';

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url?: string;
  notes?: string;
  configured: boolean;
  canSelfUpdate?: boolean;
  upgradeCommand?: string;
}

export type ApplyUpdateResult = {
  ok: boolean;
  error?: string;
  restarting?: boolean;
  upgradeCommand?: string;
};

/** Ask the server whether a newer app version is available. Null on failure. */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`${getApiBase()}/updates/check`, { credentials: 'include' });
    return await parseJsonResponseOrNull<UpdateInfo>(res);
  } catch {
    return null;
  }
}

/**
 * Run `npm install -g foxschema@latest` on the host (CLI local installs only).
 * On success the UI server relaunches; poll /api/health then reload.
 */
export async function applyUpdate(): Promise<ApplyUpdateResult> {
  try {
    const res = await fetch(`${getApiBase()}/updates/apply`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = (await parseJsonResponseOrNull<ApplyUpdateResult>(res)) ?? {
      ok: false,
      error: `Update failed (HTTP ${res.status})`,
    };
    if (!res.ok && body.ok) return { ...body, ok: false };
    return body;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update request failed',
    };
  }
}

/** Wait until the relaunched UI server answers /api/health, then reload. */
export async function waitForServerAndReload(opts?: {
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const intervalMs = opts?.intervalMs ?? 800;
  const deadline = Date.now() + timeoutMs;
  const health = `${getApiBase()}/health`;
  // Brief pause so the old process can exit before we hammer health.
  await new Promise((r) => setTimeout(r, 1200));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(health, { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      /* still down */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Server did not come back after update. Run: foxschema open');
}
