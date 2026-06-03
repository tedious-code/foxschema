import { Router } from 'express';
import { ConnectionModule } from '../modules/connection.module';
import type { ConnectionOptions } from '../interfaces/schema-provider.interface';

export function createApiRoutes(connectionModule: ConnectionModule): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/driver/check', (req, res) => {
    const dialect = String(req.query.dialect ?? '');

    try {
      const driver = connectionModule.checkDriver(dialect);
      res.json(driver);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid dialect';
      res.status(400).json({ error: message });
    }
  });

  router.post('/connection/test', async (req, res) => {
    const { dialect, option } = req.body as {
      dialect: string;
      option: ConnectionOptions;
    };

    try {
      const success = await connectionModule.testConnection(dialect, option);
      res.json({
        success,
        error: success ? undefined : 'Connection test returned false',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/schema/tables', async (req, res) => {
    const { dialect, option, schema } = req.body as {
      dialect: string;
      option: ConnectionOptions;
      schema: string;
    };

    try {
      const provider = connectionModule.getProvider(dialect);
      const tables = await provider.getTables(option, schema);
      res.json({ tables });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load schema';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
