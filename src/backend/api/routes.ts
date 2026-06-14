import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { ConnectionModule } from '../modules/connection.module';
import { CompareModule } from '../modules/compare.module';
import { MigrationModule } from '../modules/migration.module';
import { SqlGeneratorModule, MigrationStep } from '../modules/sql-generator.module';
import { DriverDetector } from '../cores/driver-detector';
import type { ConnectionOptions, DbObjectType } from '../interfaces/schema-provider.interface';

export function createApiRoutes(connectionModule: ConnectionModule): Router {
  const router = Router();
  const compareModule = new CompareModule();
  const migrationModule = new MigrationModule();
  const sqlGenerator = new SqlGeneratorModule();

  async function loadScopedTables(
    dialect: string,
    option: ConnectionOptions,
    schema: string,
    scope: DbObjectType[]
  ) {
    const provider = connectionModule.getProvider(dialect);
    if (!provider.getTables) {
      throw new Error(`Provider for dialect "${dialect}" does not support table listing`);
    }
    const tables = await provider.getTables(option, schema);
    return scope?.length ? tables.filter((t) => scope.includes(t.objectType)) : tables;
  }

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

  router.post('/schema/list', async (req: Request, res: Response) => {
    const { dialect, option } = req.body as {
      dialect: string;
      option: ConnectionOptions;
    };

    try {
      const provider = connectionModule.getProvider(dialect);
      if (!provider.listSchemas) {
        throw new Error(`Provider for dialect "${dialect}" does not support schema listing`);
      }
      const schemas = await provider.listSchemas(option);
      res.json({ schemas });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to list schemas';
      res.status(500).json({ error: message });
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
      if (!provider.getTables) {
        throw new Error(`Provider for dialect "${dialect}" does not support table listing`);
      }
      const tables = await provider.getTables(option, schema);
      res.json({ tables });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load schema';
      res.status(500).json({ error: message });
    }
  });

  router.post('/compare', async (req: Request, res: Response) => {
    const { source, target, scope } = req.body as {
      source: { dialect: string; option: ConnectionOptions; schema: string };
      target: { dialect: string; option: ConnectionOptions; schema: string };
      scope: DbObjectType[];
    };

    try {
      // Load both schemas and diff server-side; only the result crosses the wire
      const [sourceTables, targetTables] = await Promise.all([
        loadScopedTables(source.dialect, source.option, source.schema, scope),
        loadScopedTables(target.dialect, target.option, target.schema, scope),
      ]);

      const result = await compareModule.compare(sourceTables, targetTables);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Schema comparison failed';
      res.status(500).json({ error: message });
    }
  });

  router.post('/migration/execute', async (req: Request, res: Response) => {
    const { dialect, option, schema, steps } = req.body as {
      dialect: string;
      option: ConnectionOptions;
      schema: string;
      steps: MigrationStep[];
    };

    // Stream NDJSON progress events as the migration runs
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    const send = (event: unknown) => res.write(JSON.stringify(event) + '\n');

    try {
      // 1. Snapshot the target schema DDL before touching anything
      const provider = connectionModule.getProvider(dialect);
      if (provider.getTables) {
        const targetObjects = await provider.getTables(option, schema);
        let snapshot = `-- =========================================================================\n`;
        snapshot += `-- Target schema snapshot (pre-migration)\n`;
        snapshot += `-- Schema: ${schema}  |  Taken At: ${new Date().toISOString()}\n`;
        snapshot += `-- =========================================================================\n\n`;
        snapshot += targetObjects.map((t) => sqlGenerator.generateObjectDdl(t)).join('\n');
        send({ type: 'snapshot', ddl: snapshot });
      }

      // 2. Execute the plan in a single transaction, reporting per object
      await migrationModule.execute(dialect, option, schema, steps, send);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Migration failed';
      send({ type: 'done', success: false, rolledBack: false, error: message });
    }

    res.end();
  });

  return router;
}


