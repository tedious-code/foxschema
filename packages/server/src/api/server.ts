/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { corsOriginDelegate, originVerdict } from '../platform/guards/origin-policy';
import { ConnectionModule, ConnectionFactory } from '@foxschema/db';
import { AuthModule } from '../modules/auth/auth.service';
import { ConnectionStore } from '../modules/connections/connection-store.service';
import { sweepOrphanedUploadFiles } from '../modules/files/file-session.service';
import { UserModule } from '../modules/users/user.service';
import { createApiRoutes } from './routes';
import { defaultApiRateLimit, globalApiFloodgate } from '../platform/guards/rate-limit';
import { securityHeaders } from './security-headers';
import { createAuthRoutes, authGuard, localUserGuard } from '../modules/auth/auth.routes';
import { createSsoRoutes } from '../modules/auth/sso.routes';
import { createConnectionStoreRoutes } from '../modules/connections/connections.routes';
import { createAppSecretsRoutes } from '../modules/admin/app-secrets.routes';
import { createUserRoutes } from '../modules/users/user.routes';
import { createAdminRoutes } from '../modules/admin/admin.routes';
import { createSignupRoutes } from '../modules/users/signup-wizard.routes';
import { createFileQueryRoutes } from '../modules/files/files.routes';
import { DEFAULT_API_PORT } from '../defaultApiPort';
import { AppSecretsStore } from '../modules/admin/app-secrets.service';
import { resolveAppVersion } from '../internal/updates.service';
import { asAppLogger, getLogger } from '../platform/logger/logger';

// Default to single-user (no login). Set LOCAL_SINGLE_USER=false to enable
// multi-user auth. In multi-user mode AUTH_REQUIRED defaults to true (safe).
const LOCAL_SINGLE_USER = process.env.LOCAL_SINGLE_USER !== 'false';
const AUTH_REQUIRED = LOCAL_SINGLE_USER
  ? false
  : process.env.AUTH_REQUIRED !== 'false';

/**
 * One body ceiling for both servers. Fastify's own `bodyLimit` does not apply
 * while Express owns body parsing under `@fastify/express`, so the number that
 * actually bites lives here.
 */
export const BODY_LIMIT = process.env.FOX_BODY_LIMIT || '10mb';

export function createApp() {
  const app = express();

  // The driver runtime logs through whatever it is given; without this it stays
  // silent. Installed here so both servers get query timing.
  ConnectionFactory.useLogger(asAppLogger(getLogger()));

  // Before anything else, so even an early error response carries them.
  app.disable('x-powered-by');
  app.use(securityHeaders({ hsts: process.env.FOX_HSTS === '1' }));
  const connectionModule = new ConnectionModule();

  // The API holds DB credentials and can run migrations, so only named origins
  // may call it with cookies. This used to allow *any* localhost port and any
  // `.localhost` host, which let a page on an unrelated local dev server drive
  // the API with the user's session — see platform/guards/origin-policy.
  // Before cors, so a refusal is a 403 the caller can read rather than the 500
  // the cors package produces by throwing — and so a refused cross-origin
  // request never reaches a route.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const verdict = originVerdict(req.headers.origin);
    if (verdict.allowed) return next();
    res.status(verdict.status).json({ ok: false, error: verdict.error });
  });
  app.use(
    cors({
      origin: corsOriginDelegate(),
      // The frontend sends `credentials: 'include'` (session cookie).
      credentials: true,
    })
  );

  // Bounded body size — migration payloads carry routine bodies, but cap to
  // avoid unbounded memory use from a hostile request.
  app.use(express.json({ limit: BODY_LIMIT }));

  /**
   * A body the parser rejected — too large, or not JSON — used to end as an
   * empty 400 that a JSON client cannot parse, leaving the UI to report
   * "Empty response from server" for what is really a bad request.
   *
   * Registered immediately after the parser so it only sees parse failures.
   */
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const status = (err as { status?: number; statusCode?: number } | null)?.status
      ?? (err as { statusCode?: number } | null)?.statusCode;
    const type = (err as { type?: string } | null)?.type;
    if (!status || !type) return next(err);
    res.status(status).json({
      ok: false,
      error:
        type === 'entity.too.large'
          ? `Request body is larger than the ${BODY_LIMIT} limit.`
          : 'Request body could not be parsed as JSON.',
    });
  });

  // Public liveness check (registered before auth). Include version so
  // `foxschema open` can detect a stale pre-upgrade process on this port.
  app.get('/api/health', (_req: Request, res: Response) =>
    res.json({ ok: true, version: resolveAppVersion() })
  );

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({ localSingleUser: LOCAL_SINGLE_USER });
  });

  // Auth endpoints are public (you can't be logged in to log in). SSO is mounted
  // first so its sub-paths take precedence over the base auth router.
  const auth = new AuthModule();
  // Ahead of every sub-router below, so nothing mounted on a more specific
  // path can slip past it — that is precisely how the first attempt at this
  // ended up covering only a third of the surface.
  app.use('/api', globalApiFloodgate());

  app.use('/api/auth/sso', createSsoRoutes(auth));
  app.use('/api/auth', createAuthRoutes(auth));
  // First-open email subscriber wizard — must stay public (before login).
  app.use('/api/signup', createSignupRoutes());

  // In local single-user mode (community desktop) the singleton local user is
  // attached automatically; otherwise per-user routes require a real session.
  const userGuard = LOCAL_SINGLE_USER ? localUserGuard(auth) : authGuard(auth);

  const connectionStore = new ConnectionStore();
  app.use('/api/connections', userGuard, createConnectionStoreRoutes(connectionStore));
  app.use('/api/app-secrets', userGuard, createAppSecretsRoutes(new AppSecretsStore()));
  app.use('/api/user', userGuard, createUserRoutes(new UserModule()));
  app.use('/api/admin', userGuard, createAdminRoutes());
  // CSV / JSON / fixed-width text → temp SQLite credential for SQL Editor.
  app.use('/api/files', userGuard, createFileQueryRoutes(connectionStore));

  const guard = LOCAL_SINGLE_USER
    ? localUserGuard(auth)
    : AUTH_REQUIRED
      ? authGuard(auth)
      : (_req: Request, _res: Response, next: NextFunction) => next();
  // The guard runs first so the limiter can charge an authenticated user
  // rather than lumping everyone behind one shared IP bucket.
  app.use('/api', guard, defaultApiRateLimit(), createApiRoutes(connectionModule, connectionStore));

  return app;
}

export function startServer(port = Number(process.env.API_PORT) || DEFAULT_API_PORT) {
  const app = createApp();

  // Partial uploads are tracked in memory, so anything in flight when the last
  // process stopped left a .part file no live session owns. Startup is the one
  // moment we know they are orphans; without this they are never collected.
  try {
    const swept = sweepOrphanedUploadFiles();
    if (swept > 0) {
      getLogger().info({ component: 'uploads', removed: swept }, 'swept orphaned upload parts');
    }
  } catch (error: unknown) {
    // Never block boot on temp-dir housekeeping.
    getLogger().warn({ component: 'uploads', err: error }, 'upload sweep skipped');
  }

  const server = app.listen(port, () => {
    console.log(`Fox API listening on http://localhost:${port}`);
  });

  // Drain connection pools on shutdown so the process exits cleanly
  const shutdown = async (signal: string) => {
    console.log(`${signal} received — closing connection pools...`);
    await ConnectionFactory.closeAll();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return app;
}
