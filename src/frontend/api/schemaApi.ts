import type {
  ConnectionOptions,
  DriverInfo,
} from '../../backend/interfaces/schema-provider.interface';
import type { MigrationStep } from '../../backend/modules/sql-generator.module';
import type { MigrationEvent } from '../../backend/modules/migration.module';
import type { SchemaCompareResult } from '../../backend/types/diff.types';
import type { DbObjectType } from '../../backend/interfaces/schema-provider.interface';

const API_BASE = '/api';

interface CompareSide {
  dialect: string;
  option: ConnectionOptions;
  schema: string;
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
  source: CompareSide,
  target: CompareSide,
  scope: DbObjectType[]
): Promise<SchemaCompareResult> {
  // De-dupe concurrent identical compares (e.g. double-click); never cached
  const key = `compare:${JSON.stringify({ source, target, scope })}`;
  return idempotent(key, async () =>
    parseJson<SchemaCompareResult>(
      await fetch(`${API_BASE}/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, target, scope }),
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
        await fetch(`${API_BASE}/driver/check?dialect=${encodeURIComponent(dialect)}`)
      ),
    30000
  );
}

export async function installDriver(dialect: string): Promise<{ success: boolean; stdout?: string; error?: string }> {
  const result = await parseJson<{ success: boolean; stdout?: string; error?: string }>(
    await fetch(`${API_BASE}/driver/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialect }),
    })
  );
  // An install changes driver availability — drop the stale cached check
  invalidateCache(`driver:${dialect}`);
  return result;
}


export async function testConnection(
  dialect: string,
  option: ConnectionOptions,
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/connection/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dialect, option }),
  });

  const data = (await res.json()) as { success: boolean; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? res.statusText);
  }

  if (!data.success) {
    throw new Error(data.error ?? 'Connection test returned false');
  }

  return true;
}

export async function fetchSchemaList(
  dialect: string,
  option: ConnectionOptions
): Promise<string[]> {
  // Short cache: schema lists are stable within a session; dedupes the
  // back-to-back loads triggered by connect + compare-refresh
  const key = `schemas:${dialect}:${option.connectionString ?? `${option.host}/${option.database}`}`;
  return idempotent(
    key,
    async () => {
      const data = await parseJson<{ schemas: string[] }>(
        await fetch(`${API_BASE}/schema/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dialect, option }),
        })
      );
      return data.schemas;
    },
    15000
  );
}

/** Streams NDJSON migration progress events, invoking onEvent for each. */
export async function executeMigration(
  dialect: string,
  option: ConnectionOptions,
  schema: string,
  steps: MigrationStep[],
  onEvent: (e: MigrationEvent) => void
): Promise<void> {
  const res = await fetch(`${API_BASE}/migration/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dialect, option, schema, steps }),
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
