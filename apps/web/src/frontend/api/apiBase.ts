// Resolves the API base URL. The frontend is same-origin with the API
// (reached via the Vite dev proxy / reverse proxy / CLI launcher), so the
// default is '/api'.

let cached: string | null = null;

/** Set the cached API base (rarely needed — prefer resolveApiBase). */
export function setApiBase(base: string): void {
  if (base) cached = base;
}

/** Resolve and cache the API base. Call once at app boot before any fetch. */
export async function resolveApiBase(): Promise<string> {
  if (cached) return cached;
  cached = '/api';
  return cached;
}

/** Synchronous accessor for use inside requests; '/api' until resolved. */
export function getApiBase(): string {
  return cached ?? '/api';
}

export type ParseJsonOptions = {
  /** Treat an empty body as `{}` instead of throwing (auth-style endpoints). */
  allowEmpty?: boolean;
};

/**
 * Read and JSON-parse a Response body. Does not check `res.ok`.
 * Throws on empty (unless allowEmpty) or invalid JSON.
 */
export async function parseJsonBody<T>(res: Response, opts?: ParseJsonOptions): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    if (opts?.allowEmpty) return {} as T;
    throw new Error(
      res.status === 502 || res.status === 504 || res.type === 'opaque'
        ? 'API server unreachable — run `npm run dev` from the repo root (starts both the API and UI).'
        : `Empty response from server (${res.status} ${res.statusText || 'unknown'})`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid response from server (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Parse JSON from a fetch Response; throws with server `error` when not ok. */
export async function parseJsonResponse<T>(res: Response, opts?: ParseJsonOptions): Promise<T> {
  const data = await parseJsonBody<T & { error?: string }>(res, opts);
  if (!res.ok) {
    throw new Error(
      typeof data === 'object' && data && 'error' in data && data.error
        ? data.error
        : res.statusText || `Request failed (${res.status})`
    );
  }
  return data;
}

/**
 * Parse JSON when the endpoint is optional: returns null on !ok or network-ish
 * failures after a successful fetch with a non-OK status. Still throws on
 * empty/invalid JSON when status is OK.
 */
export async function parseJsonResponseOrNull<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  return parseJsonBody<T>(res);
}
