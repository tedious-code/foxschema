import { isTauri, invokeTauri, getApiBase } from './apiBase';

export type DbEngine = 'sqlite' | 'postgres' | 'mysql';

/** First-run setup state from the Tauri shell (desktop only). */
export interface SetupState {
  setup_complete: boolean;
  email: string;
  db_engine: DbEngine;
  db_path: string;
  db_url: string;
  default_db_path: string;
  api_base: string;
  sidecar_ready: boolean;
}

/** Current setup state, or null on the web (no shell / nothing to set up). */
export async function getSetupState(): Promise<SetupState | null> {
  if (!isTauri()) return null;
  return invokeTauri<SetupState>('get_setup_state');
}

export interface CompleteSetupInput {
  email: string;
  engine: DbEngine;
  /** SQLite file location (engine === 'sqlite'). */
  dbPath?: string;
  /** Connection string (engine === 'postgres' | 'mysql'). */
  dbUrl?: string;
}

/**
 * Finish setup: binds the per-install encryption key to `email` in the OS
 * keychain and spawns the API on the chosen engine. Returns the new state.
 */
export async function completeSetup(input: CompleteSetupInput): Promise<SetupState> {
  return invokeTauri<SetupState>('complete_setup', {
    email: input.email,
    engine: input.engine,
    dbPath: input.dbPath || null,
    dbUrl: input.dbUrl || null,
  });
}

/** Native save dialog for the SQLite database location (desktop only). */
export async function pickDbLocation(defaultDir?: string): Promise<string | null> {
  if (!isTauri()) return null;
  return invokeTauri<string | null>('pick_db_location', { defaultDir: defaultDir || null });
}

/** Non-secret DB/security info for the settings screen. */
export interface AppInfo {
  db: { engine: string; location: string };
  security: { keyScheme: string; emailBound: boolean; boundEmail: string };
  desktop: boolean;
}

export async function fetchAppInfo(): Promise<AppInfo> {
  const res = await fetch(`${getApiBase()}/app-info`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load app info');
  return res.json();
}

/** Validate a candidate engine/URL before switching (no effect on the live store). */
export async function testDbConnection(
  engine: DbEngine,
  url?: string,
  path?: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${getApiBase()}/db/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ engine, url, path }),
  });
  return res.json();
}

/**
 * Switch the app's metadata engine/location (desktop only). Rewrites setup.json
 * and respawns the sidecar; returns the new state (incl. api_base). Caller should
 * setApiBase + reload afterward.
 */
export async function updateDbConfig(input: {
  engine: DbEngine;
  dbPath?: string;
  dbUrl?: string;
}): Promise<SetupState> {
  return invokeTauri<SetupState>('update_db_config', {
    engine: input.engine,
    dbPath: input.dbPath || null,
    dbUrl: input.dbUrl || null,
  });
}

/**
 * Rebind the encryption key to a new email (desktop only, Settings → Security).
 * The key material is unchanged — only which keychain account holds it, and
 * setup.json's record of it, move to the new email.
 */
export async function updateEmail(email: string): Promise<SetupState> {
  return invokeTauri<SetupState>('update_email', { email });
}
