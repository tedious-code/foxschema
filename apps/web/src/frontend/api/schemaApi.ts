import type { ConnectionOptions } from '../lib/provider-settings';
import type {
  DriverInfo,
  DbObjectType,
  SchemaCompareResult,
  MigrationStep,
  MigrationEvent,
  TableSchema,
} from '../lib/types';
import { getApiBase } from './apiBase';


/** Either a saved connection (resolved server-side) or an inline ad-hoc option. */
export interface ConnectionRef {
  connectionId?: string;
  dialect?: string;
  option?: ConnectionOptions;
  schema?: string;
  /** Session password for a saved connection stored without one; merged server-side, never persisted. */
  password?: string;
}

// --- Idempotency layer -----------------------------------------------------
// Collapses duplicate work so the UI (which re-checks drivers/schemas on many
// state changes) doesn't hammer the backend: concurrent identical requests
// share one promise, and idempotent reads are cached for a short TTL.
const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { at: number; value: unknown }>();

function idempotent<T>(key: string, run: () => Promise<T>, ttlMs = 0): Promise<T> {
  if (ttlMs > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = run()
    .then((value) => {
      if (ttlMs > 0) cache.set(key, { at: Date.now(), value });
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

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof data === 'object' && data && 'error' in data && data.error
        ? data.error
        : res.statusText
    );
  }
  return data;
}

/** Runs the schema comparison server-side and returns only the diff result. */
export async function compareSchemas(
  source: ConnectionRef,
  target: ConnectionRef,
  scope: DbObjectType[]
): Promise<SchemaCompareResult> {
  // De-dupe concurrent identical compares (e.g. double-click); never cached
  const key = `compare:${JSON.stringify({ source, target, scope })}`;
  return idempotent(key, async () =>
    parseJson<SchemaCompareResult>(
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
  const key = `load:${JSON.stringify({ ref, scope })}`;
  return idempotent(key, async () =>
    parseJson<{ tables: TableSchema[]; warnings?: string[] }>(
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
      parseJson<DriverInfo>(
        await fetch(`${getApiBase()}/driver/check?dialect=${encodeURIComponent(dialect)}`)
      ),
    30000
  );
}

export async function installDriver(dialect: string): Promise<{ success: boolean; stdout?: string; error?: string }> {
  const result = await parseJson<{ success: boolean; stdout?: string; error?: string }>(
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

  const data = (await res.json()) as { success: boolean; version?: string; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? res.statusText);
  }

  if (!data.success) {
    throw new Error(data.error ?? 'Connection test returned false');
  }

  return { version: data.version };
}

export async function fetchSchemaList(ref: ConnectionRef): Promise<string[]> {
  // Short cache: schema lists are stable within a session; dedupes the
  // back-to-back loads triggered by connect + compare-refresh
  const key = `schemas:${ref.connectionId ?? `${ref.dialect}:${ref.option?.connectionString ?? `${ref.option?.host}/${ref.option?.database}`}`}`;
  return idempotent(
    key,
    async () => {
      const data = await parseJson<{ schemas: string[] }>(
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
  onEvent: (e: MigrationEvent) => void
): Promise<void> {
  const res = await fetch(`${getApiBase()}/migration/execute`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...ref, steps }),
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
