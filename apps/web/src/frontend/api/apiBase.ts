// Resolves the API base URL. On the web the frontend is same-origin with the
// API (reached via the dev proxy / reverse proxy), so it's just '/api'. In the
// Tauri desktop app the Node sidecar listens on a dynamically chosen localhost
// port, which the Rust shell exposes through the `get_api_base` command.
//
// We read Tauri's injected global (enabled via `app.withGlobalTauri`) rather
// than importing @tauri-apps/api, so the web build needs no Tauri dependency.

let cached: string | null = null;

interface TauriGlobal {
  core?: { invoke?: <T>(cmd: string, args?: unknown) => Promise<T> };
}

function tauri(): TauriGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** Resolve and cache the API base. Call once at app boot before any fetch. */
export async function resolveApiBase(): Promise<string> {
  if (cached) return cached;
  const invoke = tauri()?.core?.invoke;
  if (invoke) {
    try {
      cached = await invoke<string>('get_api_base');
      return cached;
    } catch {
      /* fall through to default if the command isn't available */
    }
  }
  cached = '/api';
  return cached;
}

/** Synchronous accessor for use inside requests; '/api' until resolved. */
export function getApiBase(): string {
  return cached ?? '/api';
}
