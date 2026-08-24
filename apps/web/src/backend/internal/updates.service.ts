import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Public npm package name used for CLI installs (`npm i -g foxschema`). */
export const NPM_PACKAGE = 'foxschema';
/** Default feed — npm dist-tag `latest` document. */
export const DEFAULT_UPDATE_FEED_URL = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`;
/** Command shown when one-click update is unavailable (Docker / locked-down hosts). */
export const MANUAL_UPDATE_COMMAND = `npm install -g ${NPM_PACKAGE}@latest`;

export type UpdateInfo = {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url?: string;
  notes?: string;
  configured: boolean;
  checkedAt: number;
  /** True when this process can run `npm install -g foxschema@latest` for the user. */
  canSelfUpdate: boolean;
  /** Suggested terminal command (always provided for copy/paste). */
  upgradeCommand: string;
};

const UPDATE_TTL_MS = 60 * 60 * 1000;
let updateCache: UpdateInfo | null = null;

/** Returns true if dotted-numeric version `a` is greater than `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function stripV(v: string): string {
  return v.replace(/^v/i, '').trim();
}

/** User-facing release notes (in-app “What’s new” opens this page). */
export function githubReleaseUrl(version: string): string {
  return `https://github.com/tedious-code/foxschema/releases/tag/v${stripV(version)}`;
}

/**
 * Resolve the running app version: APP_VERSION env, else nearest package.json
 * (web → repo root → cwd). Falls back to 0.0.0 only if nothing is readable.
 */
export function resolveAppVersion(): string {
  if (process.env.APP_VERSION) return stripV(process.env.APP_VERSION);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../package.json'), // apps/web/package.json
    join(here, '../../../../package.json'), // repo root
    join(process.cwd(), 'package.json'),
  ];
  for (const path of candidates) {
    try {
      const v = (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version;
      if (v) return stripV(v);
    } catch {
      /* try next */
    }
  }
  return '0.0.0';
}

/** Parse UPDATE_FEED_URL; empty/`off`/`false`/`none` disables the check. */
export function resolveUpdateFeedUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env.UPDATE_FEED_URL;
  if (raw == null || raw.trim() === '') return DEFAULT_UPDATE_FEED_URL;
  const v = raw.trim().toLowerCase();
  if (v === 'off' || v === 'false' || v === 'none' || v === '0') return null;
  return raw.trim();
}

type FeedJson = {
  version?: string;
  tag_name?: string;
  url?: string;
  html_url?: string;
  homepage?: string;
  notes?: string;
  body?: string;
  description?: string;
  name?: string;
};

/** Map npm / GitHub / custom feed JSON into version + link + notes. */
export function parseUpdateFeed(
  data: FeedJson,
  _feedUrl: string,
  current: string
): Pick<UpdateInfo, 'latest' | 'updateAvailable' | 'url' | 'notes'> {
  const latest = stripV(data.version || data.tag_name || '') || current;
  return {
    latest,
    updateAvailable: !!latest && isNewer(latest, current),
    // Prefer explicit release links; otherwise the GitHub Release page
    // (populated from docs/RELEASE_*.md) so “What’s new” shows ship notes.
    url: data.url || data.html_url || githubReleaseUrl(latest) || data.homepage,
    notes: data.notes || data.body || data.description || undefined,
  };
}

/** Clear in-memory cache (tests). */
export function clearUpdateCache(): void {
  updateCache = null;
}

/**
 * One-click self-update is for local npm CLI installs (`foxschema open`).
 * Disabled in Docker / when FOXSCHEMA_SELF_UPDATE=false / multi-user servers.
 */
export function canSelfUpdate(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.FOXSCHEMA_SELF_UPDATE || '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'none') return false;
  if (flag === 'true' || flag === '1' || flag === 'on') return true;
  // CLI open sets this; without it, only allow open single-user non-Docker hosts.
  if (env.LOCAL_SINGLE_USER === 'false') return false;
  try {
    if (existsSync('/.dockerenv')) return false;
  } catch {
    /* ignore */
  }
  return false;
}

function withMeta(info: Omit<UpdateInfo, 'canSelfUpdate' | 'upgradeCommand'>): UpdateInfo {
  return {
    ...info,
    canSelfUpdate: canSelfUpdate(),
    upgradeCommand: MANUAL_UPDATE_COMMAND,
  };
}

/**
 * Check npm (default) or a custom UPDATE_FEED_URL for a newer version.
 * Accepts npm registry `/latest`, `{ version, url, notes }`, or GitHub releases JSON.
 */
export async function checkForUpdate(
  fetchImpl: typeof fetch = fetch
): Promise<UpdateInfo> {
  if (updateCache && Date.now() - updateCache.checkedAt < UPDATE_TTL_MS) {
    return updateCache;
  }
  const current = resolveAppVersion();
  const feed = resolveUpdateFeedUrl();
  const base = withMeta({
    current,
    latest: current,
    updateAvailable: false,
    configured: !!feed,
    checkedAt: Date.now(),
  });
  if (!feed) return (updateCache = base);

  try {
    const res = await fetchImpl(feed, {
      headers: { Accept: 'application/json', 'User-Agent': 'FoxSchema' },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as FeedJson;
    const parsed = parseUpdateFeed(data, feed, current);
    return (updateCache = withMeta({ ...base, ...parsed }));
  } catch {
    // Don't cache transient failures (network / registry blip).
    return base;
  }
}

export type ApplyUpdateResult =
  | { ok: true; stdout: string; restarting: boolean }
  | { ok: false; error: string; stdout?: string; stderr?: string };

/**
 * Run `npm install -g foxschema@latest` (same outcome as `npm update -g foxschema`
 * when latest is newer). Caller must have already checked canSelfUpdate().
 */
export function applyNpmGlobalUpdate(
  spawnImpl: typeof spawn = spawn
): Promise<ApplyUpdateResult> {
  return new Promise((resolve) => {
    const args = ['install', '-g', `${NPM_PACKAGE}@latest`];
    const proc = spawnImpl('npm', args, {
      stdio: 'pipe',
      // 'false', not '': npm reads an empty env value as unset, leaving an
      // ignore-scripts=true from the user's .npmrc in force. A self-update
      // that skips install scripts leaves native drivers half-built.
      env: { ...process.env, npm_config_ignore_scripts: 'false' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        const detail = (stderr || stdout).trim().slice(-2000);
        resolve({
          ok: false,
          error:
            `npm install -g ${NPM_PACKAGE}@latest failed (exit ${code})` +
            (detail ? `: ${detail}` : '') +
            `. Try manually: ${MANUAL_UPDATE_COMMAND}`,
          stdout,
          stderr,
        });
        return;
      }
      resolve({ ok: true, stdout, restarting: true });
    });
    proc.on('error', (err: Error) => {
      resolve({
        ok: false,
        error: `Failed to run npm (${err.message}). Try manually: ${MANUAL_UPDATE_COMMAND}`,
      });
    });
  });
}

/**
 * After a successful global install, relaunch `foxschema open` on the same port
 * and exit this process so the new package binary / ui-dist is used.
 */
export function scheduleUiRelaunch(opts?: {
  port?: number;
  spawnImpl?: typeof spawn;
  exitFn?: (code: number) => void;
  delayMs?: number;
}): void {
  const port = opts?.port ?? (Number(process.env.API_PORT || process.env.PORT) || 3210);
  const spawnImpl = opts?.spawnImpl ?? spawn;
  const exitFn = opts?.exitFn ?? ((code) => process.exit(code));
  const delayMs = opts?.delayMs ?? 400;
  const bin = process.env.FOXSCHEMA_BIN || 'foxschema';

  // Detached shell so relaunch survives our exit. --no-open: browser tab stays;
  // the SPA reloads once /api/health is back.
  if (process.platform === 'win32') {
    spawnImpl(
      'cmd.exe',
      ['/d', '/s', '/c', `timeout /t 2 /nobreak >nul & "${bin}" open --port ${port} --no-open`],
      { detached: true, stdio: 'ignore', windowsHide: true }
    ).unref();
  } else {
    spawnImpl(
      'sh',
      ['-c', `sleep 2; exec "${bin}" open --port ${port} --no-open`],
      { detached: true, stdio: 'ignore' }
    ).unref();
  }

  setTimeout(() => exitFn(0), delayMs);
}
