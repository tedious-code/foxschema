import type { ConnectionOptions } from '../lib/provider-settings';
import type {
  DriverInfo,
  DbObjectType,
  SchemaCompareResult,
  MigrationStep,
  MigrationEvent,
  TableSchema,
} from '../lib/types';
import { getApiBase, parseJsonResponse } from './apiBase';


/** Either a saved connection (resolved server-side) or an inline ad-hoc option. */
export interface ConnectionRef {
  connectionId?: string;
  dialect?: string;
  option?: ConnectionOptions;
  schema?: string;
  /** Session password for a saved connection stored without one; merged server-side, never persisted. */
  password?: string;
}

const CACHE_MAX_ENTRIES = 64;

// --- Idempotency layer -----------------------------------------------------
// Collapses duplicate work so the UI (which re-checks drivers/schemas on many
// state changes) doesn't hammer the backend: concurrent identical requests
// share one promise, and idempotent reads are cached for a short TTL.
const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { at: number; value: unknown; ttlMs: number }>();

/** Stable cache key that never embeds password or connectionString. */
export function cacheKeyForRef(ref: ConnectionRef): string {
  if (ref.connectionId) return `id:${ref.connectionId}`;
  const o = ref.option;
  return [
    ref.dialect ?? '',
    o?.host ?? '',
    o?.port ?? '',
    o?.database ?? '',
    ref.schema ?? o?.schema ?? '',
    o?.username ?? '',
  ].join('|');
}

function pruneCache(now = Date.now()): void {
  for (const [key, hit] of cache) {
    if (hit.ttlMs > 0 && now - hit.at >= hit.ttlMs) cache.delete(key);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function cacheGet(key: string, ttlMs: number): unknown | undefined {
  if (ttlMs <= 0) return undefined;
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= ttlMs) {
    cache.delete(key);
    return undefined;
  }
  // Refresh LRU order
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (ttlMs <= 0) return;
  cache.delete(key);
  cache.set(key, { at: Date.now(), value, ttlMs });
  pruneCache();
}

function idempotent<T>(key: string, run: () => Promise<T>, ttlMs = 0): Promise<T> {
  const cached = cacheGet(key, ttlMs);
  if (cached !== undefined) return Promise.resolve(cached as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = run()
    .then((value) => {
      cacheSet(key, value, ttlMs);
      return value;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

/** Drop cached driver/schema results for a connection (e.g. after install or reconnect). */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Runs the schema comparison server-side and returns only the diff result. */
export async function compareSchemas(
  source: ConnectionRef,
  target: ConnectionRef,
  scope: DbObjectType[]
): Promise<SchemaCompareResult> {
  // De-dupe concurrent identical compares (e.g. double-click); never cached
  const key = `compare:${cacheKeyForRef(source)}:${cacheKeyForRef(target)}:${scope.join(',')}`;
  return idempotent(key, async () =>
    parseJsonResponse<SchemaCompareResult>(
      await fetch(`${getApiBase()}/compare`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, target, scope }),
      })
    )
  );
}

/** Loads one schema's scoped objects (no comparison) for browse/search mode. */
export async function loadSchema(
  ref: ConnectionRef,
  scope: DbObjectType[]
): Promise<{ tables: TableSchema[]; warnings?: string[] }> {
  // De-dupe concurrent identical loads (e.g. double-click); never cached
  const key = `load:${cacheKeyForRef(ref)}:${scope.join(',')}`;
  return idempotent(key, async () =>
    parseJsonResponse<{ tables: TableSchema[]; warnings?: string[] }>(
      await fetch(`${getApiBase()}/schema/load`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ref, scope }),
      })
    )
  );
}

export async function checkDriver(dialect: string): Promise<DriverInfo> {
  // Driver-installed status rarely changes — cache for 30s, dedupe concurrent checks
  return idempotent(
    `driver:${dialect}`,
    async () =>
      parseJsonResponse<DriverInfo>(
        await fetch(`${getApiBase()}/driver/check?dialect=${encodeURIComponent(dialect)}`)
      ),
    30000
  );
}

export async function installDriver(dialect: string): Promise<{ success: boolean; stdout?: string; error?: string }> {
  const result = await parseJsonResponse<{ success: boolean; stdout?: string; error?: string }>(
    await fetch(`${getApiBase()}/driver/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialect }),
    })
  );
  // An install changes driver availability — drop the stale cached check
  invalidateCache(`driver:${dialect}`);
  return result;
}


export async function testConnection(ref: ConnectionRef): Promise<{ version?: string }> {
  const res = await fetch(`${getApiBase()}/connection/test`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ref),
  });

  const data = await parseJsonResponse<{ success: boolean; version?: string; error?: string }>(res);
  if (!data.success) {
    throw new Error(data.error ?? 'Connection test returned false');
  }

  return { version: data.version };
}

export async function fetchSchemaList(ref: ConnectionRef): Promise<string[]> {
  // Short cache: schema lists are stable within a session; dedupes the
  // back-to-back loads triggered by connect + compare-refresh
  const key = `schemas:${cacheKeyForRef(ref)}`;
  return idempotent(
    key,
    async () => {
      const data = await parseJsonResponse<{ schemas: string[] }>(
        await fetch(`${getApiBase()}/schema/list`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ref),
        })
      );
      return data.schemas;
    },
    15000
  );
}

/** Streams NDJSON migration progress events, invoking onEvent for each. */
export async function executeMigration(
  ref: ConnectionRef,
  steps: MigrationStep[],
  onEvent: (e: MigrationEvent) => void,
  continueOnError?: boolean
): Promise<void> {
  const res = await fetch(`${getApiBase()}/migration/execute`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...ref, steps, continueOnError: !!continueOnError }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Migration request failed: ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) onEvent(JSON.parse(line) as MigrationEvent);
    }
  }
}
