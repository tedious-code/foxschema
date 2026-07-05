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
import { createUserRoutes } from './user.routes';

// Default to single-user (no auth). Set LOCAL_SINGLE_USER=false + AUTH_REQUIRED=true
// in the environment to enable multi-user auth for self-hosted deployments.
const LOCAL_SINGLE_USER = process.env.LOCAL_SINGLE_USER !== 'false';

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
          // Tauri webview origins: tauri://localhost (macOS/Linux) and
          // http://tauri.localhost (Windows). Plus the usual local hosts.
          if (
            url.protocol === 'tauri:' ||
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
      // The frontend sends `credentials: 'include'` (session cookie on web).
      // Cross-origin from the Tauri webview, the browser then requires this
      // header to be true and the origin to be reflected (not '*').
      credentials: true,
    })
  );

  // Bounded body size — migration payloads carry routine bodies, but cap to
  // avoid unbounded memory use from a hostile request.
  app.use(express.json({ limit: '10mb' }));

  // Public liveness check
  app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

  // Auth endpoints are public (you can't be logged in to log in). SSO is mounted
  // first so its sub-paths take precedence over the base auth router.
  const auth = new AuthModule();
  app.use('/api/auth/sso', createSsoRoutes(auth));
  app.use('/api/auth', createAuthRoutes(auth));

  // In local single-user mode (community desktop) the singleton local user is
  // attached automatically; otherwise per-user routes require a real session.
  const userGuard = LOCAL_SINGLE_USER ? localUserGuard(auth) : authGuard(auth);

  // Per-user resources — always require a user, even while the global guard
  // is off during the transition.
  const connectionStore = new ConnectionStore();
  app.use('/api/connections', userGuard, createConnectionStoreRoutes(connectionStore));
  app.use('/api/user', userGuard, createUserRoutes(new UserModule()));

  // Everything else requires a session once AUTH_REQUIRED is enabled. It stays
  // off until the frontend login flow ships, so the app keeps working today.
  // Local single-user mode always attaches the local user.
  const guard = LOCAL_SINGLE_USER
    ? localUserGuard(auth)
    : process.env.AUTH_REQUIRED === 'true'
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
