import express from 'express';
import cors from 'cors';
import { ConnectionModule } from '../modules/connection.module';
import { ConnectionFactory } from '../cores/connection-factory';
import { createApiRoutes } from './routes';

export function createApp() {
  const app = express();
  const connectionModule = new ConnectionModule();

  app.use(cors());
  app.use(express.json());
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
