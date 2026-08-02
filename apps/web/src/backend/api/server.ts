/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ConnectionModule, ConnectionFactory } from '@foxschema/core';
import { AuthModule } from '../modules/auth.module';
import { ConnectionStore } from '../modules/connection-store.module';
import { UserModule } from '../modules/user.module';
import { createApiRoutes } from './routes';
import { createAuthRoutes, authGuard, localUserGuard } from './auth.routes';
import { createSsoRoutes } from './sso.routes';
import { createConnectionStoreRoutes } from './connection-store.routes';
import { createAppSecretsRoutes } from './app-secrets.routes';
import { createUserRoutes } from './user.routes';
import { createAdminRoutes } from './admin.routes';
import { createSignupRoutes } from './signup.routes';
import { createFileQueryRoutes } from './file-query.routes';
import { AppSecretsStore } from '../modules/app-secrets.module';

// Default to single-user (no login). Set LOCAL_SINGLE_USER=false to enable
// multi-user auth. In multi-user mode AUTH_REQUIRED defaults to true (safe).
const LOCAL_SINGLE_USER = process.env.LOCAL_SINGLE_USER !== 'false';
const AUTH_REQUIRED = LOCAL_SINGLE_USER
  ? false
  : process.env.AUTH_REQUIRED !== 'false';

export function createApp() {
  const app = express();
  const connectionModule = new ConnectionModule();

  // The API holds DB credentials and can run migrations, so only allow the
  // local app to call it — this blocks a malicious site in the user's browser
  // from reaching http://localhost:<port>/api and reading/triggering anything.
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin / curl / dev proxy
        try {
          const url = new URL(origin);
          const host = url.hostname;
          if (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host.endsWith('.localhost')
          ) {
            return cb(null, true);
          }
        } catch {
          /* malformed origin → reject below */
        }
        cb(new Error('Origin not allowed'));
      },
      // The frontend sends `credentials: 'include'` (session cookie).
      credentials: true,
    })
  );

  // Bounded body size — migration payloads carry routine bodies, but cap to
  // avoid unbounded memory use from a hostile request.
  app.use(express.json({ limit: '10mb' }));

  // Public liveness check
  app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({ localSingleUser: LOCAL_SINGLE_USER });
  });

  // Auth endpoints are public (you can't be logged in to log in). SSO is mounted
  // first so its sub-paths take precedence over the base auth router.
  const auth = new AuthModule();
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
  app.use('/api', guard, createApiRoutes(connectionModule, connectionStore));

  return app;
}

export function startServer(port = Number(process.env.API_PORT) || 3001) {
  const app = createApp();

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
