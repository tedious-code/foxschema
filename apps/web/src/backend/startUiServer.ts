import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import http from 'node:http';
import express from 'express';
import { ConnectionFactory, setupDb2ClientEnv } from '@foxschema/db';
import { createApp } from './api/server';
import { DEFAULT_API_PORT } from './defaultApiPort';

export interface StartUiServerOptions {
  /** Listen port. Defaults to API_PORT / PORT / DEFAULT_API_PORT (3210). */
  port?: number;
  /** Absolute path to the Vite `dist` directory. Defaults to STATIC_DIR or apps/web/dist. */
  staticDir?: string;
  /** Bind address. Defaults to 127.0.0.1 for local CLI; Docker uses 0.0.0.0 via listen(). */
  host?: string;
}

export interface StartedUiServer {
  port: number;
  host: string;
  staticDir: string;
  server: http.Server;
  close: () => Promise<void>;
}

/**
 * Start the single-origin UI + API server (Docker / CLI browser launcher).
 * Shared by `serve.ts` and the CLI `foxschema open` child process.
 */
/**
 * Which HTTP server to run.
 *
 * `FOX_SERVER=fastify` puts the Fastify edge in front of the same Express
 * routers: same routes, same handlers, same guards, with the security policies
 * enforced in native hooks before anything downstream. Express stays the
 * default until the flag has run in anger.
 */
export function serverFlavour(): 'express' | 'fastify' {
  return process.env.FOX_SERVER === 'fastify' ? 'fastify' : 'express';
}

export function startUiServer(opts: StartUiServerOptions = {}): StartedUiServer {
  setupDb2ClientEnv();

  const app = createApp();
  const staticDir =
    opts.staticDir ||
    process.env.STATIC_DIR ||
    resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');

  app.use(express.static(staticDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(join(staticDir, 'index.html'));
  });

  const port = opts.port ?? (Number(process.env.API_PORT || process.env.PORT) || DEFAULT_API_PORT);
  const host = opts.host ?? process.env.LISTEN_HOST ?? '0.0.0.0';

  const server = app.listen(port, host);
  const close = async () => {
    await ConnectionFactory.closeAll();
    await new Promise<void>((resolveClose, reject) => {
      server.close((err) => (err ? reject(err) : resolveClose()));
    });
  };

  return { port, host, staticDir, server, close };
}
