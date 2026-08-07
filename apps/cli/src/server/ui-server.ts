#!/usr/bin/env node
/**
 * Detached UI server process entry for `foxschema open`.
 * Env (API_PORT, STATIC_DIR, APP_ENCRYPTION_KEY, APP_DB_*) is set by the parent.
 */
import { startUiServer } from '@foxschema/web/serve';

// So Activity Monitor / `ps` / Task Manager “window title” can identify us
// (Image Name on Windows is still node.exe — see docs).
try {
  process.title = 'foxschema';
} catch {
  /* ignore */
}

const port = Number(process.env.API_PORT || process.env.PORT) || 3210;
const host = process.env.LISTEN_HOST || '127.0.0.1';
const staticDir = process.env.STATIC_DIR;

const { server } = startUiServer({ port, host, staticDir });

server.on('listening', () => {
  console.log(`Fox Schema UI server listening on http://${host}:${port}`);
});

server.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

const shutdown = async () => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
