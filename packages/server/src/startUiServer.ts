/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The single-origin server: the built frontend and the API on one port.
 *
 * Used by Docker, by `apps/web`'s serve entry, and by the CLI's `foxschema
 * open` child process.
 */
import { join } from 'node:path';
import type http from 'node:http';
import { ConnectionFactory, setupDb2ClientEnv } from '@foxschema/db';
import { createFastifyApp } from './api/fastify-server';
import { sweepOnBoot } from './api/server';
import { DEFAULT_API_PORT } from './defaultApiPort';

export interface StartUiServerOptions {
  /** Listen port. Defaults to API_PORT / PORT / DEFAULT_API_PORT (3210). */
  port?: number;
  /**
   * Absolute path to the built frontend. Falls back to STATIC_DIR; there is
   * no default, because this package must not know where an app puts its dist.
   */
  staticDir?: string;
  /** Bind address. Defaults to 0.0.0.0 so Docker can reach it. */
  host?: string;
}

export interface StartedUiServer {
  port: number;
  host: string;
  staticDir: string;
  /** The underlying Node server, already listening. */
  server: http.Server;
  close: () => Promise<void>;
}

export async function startUiServer(opts: StartUiServerOptions = {}): Promise<StartedUiServer> {
  setupDb2ClientEnv();

  // The frontend's location is the caller's business, not the server's.
  // This used to default to `../../dist`, which resolved to apps/web/dist —
  // fine while this code lived inside that app, and a dependency pointing the
  // wrong way now that it does not. Both real callers already know the answer:
  // the CLI resolves the packaged or workspace dist and passes STATIC_DIR, and
  // apps/web's serve entry passes its own.
  const staticDir = opts.staticDir || process.env.STATIC_DIR;
  if (!staticDir) {
    throw new Error(
      'startUiServer needs a staticDir: pass it, or set STATIC_DIR to the built frontend.'
    );
  }

  // Static serving and the SPA fallback live in createFastifyApp, because
  // Fastify permits exactly one not-found handler per instance and setting a
  // second one throws at boot — which is how this was found.
  const app = await createFastifyApp({ staticDir });

  sweepOnBoot();

  const requested =
    opts.port ?? (Number(process.env.API_PORT || process.env.PORT) || DEFAULT_API_PORT);
  const host = opts.host ?? process.env.LISTEN_HOST ?? '0.0.0.0';
  await app.listen({ port: requested, host });

  // Report the port actually bound, not the one asked for: port 0 means "any
  // free port", and returning the 0 back is useless to a caller that has to
  // connect to it.
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : requested;

  const close = async () => {
    await ConnectionFactory.closeAll();
    await app.close();
  };

  return { port, host, staticDir, server: app.server, close };
}

/**
 * Which HTTP server to run.
 *
 * There is only one now. Kept as a function because the CLI and the Docker
 * entrypoint both report it, and because `FOX_SERVER` may still be set in an
 * existing deployment's environment — answering honestly beats pretending the
 * flag still switches anything.
 */
export function serverFlavour(): 'fastify' {
  return 'fastify';
}

/** Retained for callers that only need the SPA fallback path. */
export const spaFallbackFile = (staticDir: string): string => join(staticDir, 'index.html');
