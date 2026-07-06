import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import express from 'express';
import { ConnectionFactory, setupDb2ClientEnv } from '@foxschema/core';
import { createApp } from './api/server';

/**
 * Production web entry (Docker / self-host). Unlike the desktop sidecar
 * (index.ts -> startServer, API only — Tauri serves its own frontend), this
 * one serves the built Vite frontend AND the /api routes from a SINGLE origin
 * on a SINGLE configurable port. That's what lets the container be deployed
 * behind one port with no CORS: the web frontend already calls the API at the
 * relative path "/api" (see apps/web/src/frontend/api/apiBase.ts).
 *
 * createApp() (shared with the desktop sidecar and the tests) is left exactly
 * as-is; static serving is layered on top here only.
 */

// Read a local .env if present (dev convenience); real deployments pass env directly.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

setupDb2ClientEnv();

// Fail fast on a missing encryption key rather than booting and only erroring
// when someone first saves a connection. The crypto layer also enforces this,
// but lazily — catching it here makes a misconfigured deployment obvious at
// startup. (docker-compose.app.yml additionally refuses to start without it.)
if (process.env.NODE_ENV === 'production' && !process.env.APP_ENCRYPTION_KEY) {
  console.error(
    'FATAL: APP_ENCRYPTION_KEY is required in production — it encrypts saved database\n' +
      'passwords at rest. Generate one and set it in the environment:\n' +
      '  openssl rand -hex 32'
  );
  process.exit(1);
}

const app = createApp();

// The built frontend. Defaults to apps/web/dist relative to this file; the
// Docker image sets STATIC_DIR explicitly to an absolute path.
const staticDir = process.env.STATIC_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');

app.use(express.static(staticDir));

// SPA fallback: any non-/api GET returns index.html so client-side routing works.
// A RegExp route (not a string wildcard) both excludes /api cleanly and avoids
// Express 5's path-to-regexp wildcard changes.
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(join(staticDir, 'index.html'));
});

// Honor PORT too — Cloud Run / Render / Railway / Fly inject it. API_PORT wins
// when both are set, matching the rest of the app's convention.
const port = Number(process.env.API_PORT || process.env.PORT) || 3001;

const server = app.listen(port, () => {
  console.log(`Fox listening on http://localhost:${port}  (UI + API)`);
});

// Drain DB connection pools on shutdown so the container exits cleanly.
const shutdown = async (signal: string) => {
  console.log(`${signal} received — closing connection pools...`);
  await ConnectionFactory.closeAll();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
