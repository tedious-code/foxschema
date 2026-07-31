import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Public npm package name used for CLI installs (`npm i -g foxschema`). */
export const NPM_PACKAGE = 'foxschema';
/** Default feed — npm dist-tag `latest` document. */
export const DEFAULT_UPDATE_FEED_URL = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`;

export type UpdateInfo = {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url?: string;
  notes?: string;
  configured: boolean;
  checkedAt: number;
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
  feedUrl: string,
  current: string
): Pick<UpdateInfo, 'latest' | 'updateAvailable' | 'url' | 'notes'> {
  const latest = stripV(data.version || data.tag_name || '') || current;
  const fromNpm =
    data.name === NPM_PACKAGE || /registry\.npmjs\.org/i.test(feedUrl);
  const npmPage = fromNpm
    ? `https://www.npmjs.com/package/${NPM_PACKAGE}/v/${latest}`
    : undefined;
  return {
    latest,
    updateAvailable: !!latest && isNewer(latest, current),
    // Prefer explicit release links; for the npm channel use the package page
    // (homepage alone is not version-specific).
    url: data.url || data.html_url || npmPage || data.homepage,
    notes: data.notes || data.body || data.description || undefined,
  };
}

/** Clear in-memory cache (tests). */
export function clearUpdateCache(): void {
  updateCache = null;
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
  const base: UpdateInfo = {
    current,
    latest: current,
    updateAvailable: false,
    configured: !!feed,
    checkedAt: Date.now(),
  };
  if (!feed) return (updateCache = base);

  try {
    const res = await fetchImpl(feed, {
      headers: { Accept: 'application/json', 'User-Agent': 'FoxSchema' },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as FeedJson;
    const parsed = parseUpdateFeed(data, feed, current);
    return (updateCache = { ...base, ...parsed });
  } catch {
    // Don't cache transient failures (network / registry blip).
    return base;
  }
}
