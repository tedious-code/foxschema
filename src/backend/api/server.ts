import express from 'express';
import cors from 'cors';
import { ConnectionModule } from '../modules/connection.module';
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

  app.listen(port, () => {
    console.log(`SchemaCompare API listening on http://localhost:${port}`);
  });

  return app;
}
