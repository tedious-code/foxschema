import { randomUUID } from 'node:crypto';
import { setupDb2ClientEnv } from '@foxschema/core';
import { startServer } from './api/server';
import { AppSettingsStore } from './modules/app-settings.module';

// Load a local .env (SSO credentials, UPDATE_FEED_URL, etc.) from the working
// directory if present — convenient for local dev. No-ops when there's no file.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

setupDb2ClientEnv();

/**
 * One-shot mode used by the desktop shell (Tauri `enforce_install_binding`) to
 * check whether a SQLite metadata DB was ever bound to THIS machine, before the
 * real server starts. Prints a single JSON line to stdout and exits — never
 * starts listening. Only meaningful for the sqlite engine: Postgres/MySQL are
 * server-side and not portable by copying a file, so there's nothing to bind.
 */
async function checkInstallBinding(): Promise<void> {
  try {
    if ((process.env.APP_DB_ENGINE || 'sqlite') !== 'sqlite') {
      console.log(JSON.stringify({ ok: true, id: null, skipped: true }));
      return;
    }
    const settings = new AppSettingsStore();
    let id = await settings.get('install_binding_id');
    let generated = false;
    if (!id) {
      id = randomUUID();
      await settings.set('install_binding_id', id);
      generated = true;
    }
    console.log(JSON.stringify({ ok: true, id, generated }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}

if (process.argv.includes('--check-install-binding')) {
  checkInstallBinding();
} else {
  startServer();
}
