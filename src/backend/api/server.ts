import express from 'express';
import cors from 'cors';
import { ConnectionModule } from '../modules/connection.module';
import { ConnectionFactory } from '../cores/connection-factory';
import { createApiRoutes } from './routes';

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
          const host = new URL(origin).hostname;
          if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
            return cb(null, true);
          }
        } catch {
          /* malformed origin → reject below */
        }
        cb(new Error('Origin not allowed'));
      },
    })
  );

  // Bounded body size — migration payloads carry routine bodies, but cap to
  // avoid unbounded memory use from a hostile request.
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', createApiRoutes(connectionModule));

  return app;
}

export function startServer(port = Number(process.env.API_PORT) || 3001) {
  const app = createApp();

  const server = app.listen(port, () => {
    console.log(`SchemaCompare API listening on http://localhost:${port}`);
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
