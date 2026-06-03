import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { ConnectionModule } from '../modules/connection.module';
import { DriverDetector } from '../cores/driver-detector';
import type { ConnectionOptions } from '../interfaces/schema-provider.interface';

export function createApiRoutes(connectionModule: ConnectionModule): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get('/driver/check', (req: Request, res: Response) => {
    const dialect = String(req.query.dialect ?? '');

    try {
      const driver = connectionModule.checkDriver(dialect);
      res.json(driver);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid dialect';
      res.status(400).json({ error: message });
    }
  });

  router.post('/driver/install', (req: Request, res: Response) => {
    const { dialect } = req.body as { dialect: string };

    try {
      const packageName = DriverDetector.getPackageName(dialect);
      
      // Execute npm install with ignore-scripts so DB2 won't crash on compilation during general setup
      exec(`pnpm add ${packageName} --ignore-scripts`, (error, stdout, stderr) => {
        if (error) {
          res.status(500).json({
            success: false,
            error: error.message,
            stderr: stderr
          });
          return;
        }
        res.json({
          success: true,
          stdout: stdout
        });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Installation failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/connection/test', async (req: Request, res: Response) => {
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

  router.post('/schema/tables', async (req: Request, res: Response) => {
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


