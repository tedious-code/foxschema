import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import chalk from 'chalk';
import { ensureUiEnv } from '../runtime/ensureUiEnv';
import { openBrowser } from '../runtime/openBrowser';
import { resolveStaticDir, resolveUiServerEntry } from '../runtime/resolvePaths';
import {
  DEFAULT_UI_PORT,
  PID_FILE,
  PORT_FILE,
  RUNTIME_DIR,
} from '../runtime/paths';

export interface OpenOptions {
  port?: number;
  noOpen?: boolean;
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

function readManagedPid(): number | null {
  try {
    const n = Number(readFileSync(PID_FILE, 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearLock(): void {
  for (const f of [PID_FILE, PORT_FILE]) {
    try {
      unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

function writeLock(pid: number, port: number): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid), { mode: 0o600 });
  writeFileSync(PORT_FILE, String(port), { mode: 0o600 });
}

async function waitUntilHealthy(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Ensure the local UI server is running on the given port, then open the browser.
 * A second invoke only opens the browser when the managed (or any) server is healthy.
 */
export async function runOpen(opts: OpenOptions = {}): Promise<void> {
  const port = opts.port ?? (Number(process.env.FOXSCHEMA_PORT) || DEFAULT_UI_PORT);
  const url = `http://localhost:${port}`;

  if (await isHealthy(port)) {
    console.log(chalk.green(`Fox Schema already running at ${url}`));
    if (!opts.noOpen) await openBrowser(url);
    return;
  }

  // Stale lock from a dead process
  const oldPid = readManagedPid();
  if (oldPid && !isProcessAlive(oldPid)) clearLock();

  // Port occupied by something that isn't our /api/health endpoint
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    throw new Error(
      `Port ${port} is in use but does not look like Fox Schema. ` +
        `Stop that process, or run \`foxschema open --port <other>\`.`
    );
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Port ')) throw e;
    /* connection refused / timeout — free to bind */
  }

  const keySource = ensureUiEnv();
  const staticDir = resolveStaticDir();
  const { command, args } = resolveUiServerEntry();

  console.log(chalk.dim(`Starting Fox Schema UI on ${url}…`));
  if (keySource.source === 'generated') {
    console.log(chalk.dim('Generated a local encryption key (saved under your user data dir).'));
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
      API_PORT: String(port),
      PORT: String(port),
      LISTEN_HOST: '127.0.0.1',
      STATIC_DIR: staticDir,
      AUTH_REQUIRED: 'false',
      LOCAL_SINGLE_USER: 'true',
      APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
      APP_KEY_SCHEME: process.env.APP_KEY_SCHEME || 'v1',
      APP_DB_ENGINE: process.env.APP_DB_ENGINE || 'sqlite',
      APP_DB_PATH: process.env.APP_DB_PATH,
      APP_DB_URL: process.env.APP_DB_URL,
      APP_USER_EMAIL: process.env.APP_USER_EMAIL,
      EDITION: process.env.EDITION || 'community',
    },
  });

  if (!child.pid) {
    throw new Error('Failed to spawn the UI server process.');
  }

  writeLock(child.pid, port);
  child.unref();

  const ok = await waitUntilHealthy(port);
  if (!ok) {
    clearLock();
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
    throw new Error(
      `UI server did not become ready on port ${port}. ` +
        'Check that the frontend is built (`npm run build -w @foxschema/web`) and try `foxschema doctor`.'
    );
  }

  console.log(chalk.green.bold(`✔ Fox Schema is ready at ${url}`));
  if (!opts.noOpen) {
    await openBrowser(url);
    console.log(chalk.dim('Opened in your browser. Run `foxschema stop` to shut down the server.'));
  } else {
    console.log(chalk.dim('Server started (--no-open). Run `foxschema stop` to shut it down.'));
  }

  // Reassure TypeScript / tooling that the lock file path was used.
  void existsSync(PID_FILE);
}

/** Stop the managed UI server started by `foxschema open`. */
export async function runStop(): Promise<void> {
  const pid = readManagedPid();
  if (!pid) {
    console.log(chalk.yellow('No managed Fox Schema UI server is running.'));
    return;
  }
  if (!isProcessAlive(pid)) {
    clearLock();
    console.log(chalk.yellow('UI server was not running (cleared stale lock).'));
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    throw new Error(`Could not stop PID ${pid}: ${e instanceof Error ? e.message : e}`);
  }
  // Wait briefly for exit
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  clearLock();
  console.log(chalk.green('✔ Fox Schema UI server stopped.'));
}
