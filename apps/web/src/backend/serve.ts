import { ConnectionFactory } from '@foxschema/core';
import { startUiServer } from './startUiServer';

/**
 * Production web entry (Docker / self-host / CLI child process).
 * Serves the built Vite frontend AND /api from a single origin.
 *
 * createApp() (shared with the desktop sidecar and the tests) is left exactly
 * as-is; static serving is layered on top in startUiServer().
 */

// Read a local .env if present (dev convenience); real deployments pass env directly.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

// Encryption key must be present in production. The Docker entrypoint
// (docker-entrypoint.sh) auto-generates and persists one under /data when unset,
// so plain `docker pull && docker run -v …:/data` works. Bare process deploys
// without that helper still need an explicit APP_ENCRYPTION_KEY.
if (process.env.NODE_ENV === 'production' && !process.env.APP_ENCRYPTION_KEY) {
  console.error(
    'FATAL: APP_ENCRYPTION_KEY is required in production — it encrypts saved database\n' +
      'passwords at rest. Generate one and set it in the environment:\n' +
      '  openssl rand -hex 32\n' +
      'Or run the Docker image with a /data volume (entrypoint auto-creates the key).\n' +
      'Or use `foxschema open` (CLI auto-manages a local key under XDG data).'
  );
  process.exit(1);
}

const { port, server } = startUiServer();

server.on('listening', () => {
  console.log(`Fox listening on http://localhost:${port}  (UI + API)`);
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received — closing connection pools...`);
  await ConnectionFactory.closeAll();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
