import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import {
  ConnectionModule,
  CompareModule,
  MigrationModule,
  SqlGeneratorModule,
  DriverDetector,
  type MigrationStep,
  type ConnectionOptions,
  type DbObjectType,
} from '@foxschema/core';
import { ConnectionStore } from '../modules/connection-store.module';
import { MigrationHistoryStore, type MigrationObjectResult, type MigrationRunStatus } from '../modules/migration-history.module';
import { AppSettingsStore } from '../modules/app-settings.module';
import { getMetadataDbConfig, SUPPORTED_ENGINES, type DbEngine } from '../database/config';
import { createMetadataStore } from '../database/providers/registry';
import { keySchemeInfo } from '../cores/crypto';
import type { AuthedRequest } from './auth.routes';

/**
 * A connection reference: either a saved connection (resolved server-side so the
 * password never leaves the server) or an inline ad-hoc option.
 */
interface ConnectionRef {
  connectionId?: string;
  dialect?: string;
  option?: ConnectionOptions;
  schema?: string;
}

export function createApiRoutes(connectionModule: ConnectionModule, connectionStore: ConnectionStore): Router {
  const router = Router();
  const compareModule = new CompareModule();
  const migrationModule = new MigrationModule();
  const sqlGenerator = new SqlGeneratorModule();
  const migrationHistory = new MigrationHistoryStore();
  const appSettings = new AppSettingsStore();

  /** Resolve a ConnectionRef to concrete credentials (decrypting a saved one). */
  async function resolveRef(
    userId: string | undefined,
    ref: ConnectionRef
  ): Promise<{ dialect: string; option: ConnectionOptions; schema: string }> {
    if (ref.connectionId) {
      if (!userId) throw new Error('Sign in to use a saved connection');
      const resolved = await connectionStore.resolve(userId, ref.connectionId);
      if (!resolved) throw new Error('Saved connection not found');
      return { dialect: resolved.dialect, option: resolved.option, schema: ref.schema ?? resolved.schema ?? '' };
    }
    if (!ref.dialect || !ref.option) throw new Error('A connectionId or (dialect + option) is required');
    return { dialect: ref.dialect, option: ref.option, schema: ref.schema ?? '' };
  }

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

  // Non-secret info about where the app's metadata DB lives and how the
  // credential-encryption key is bound — for the "Database & Security" settings
  // section. Never exposes the key itself.
  router.get('/app-info', async (_req: Request, res: Response) => {
    const cfg = getMetadataDbConfig();
    const key = keySchemeInfo();
    // Persist a durable record of the active config (useful for later tooling).
    try {
      await appSettings.set('db.engine', cfg.engine);
      if (cfg.path) await appSettings.set('db.path', cfg.path);
      if (key.boundEmail) await appSettings.set('key.boundEmail', key.boundEmail);
      await appSettings.set('key.scheme', key.scheme);
    } catch {
      /* best-effort; never block the response */
    }
    res.json({
      db: { engine: cfg.engine, location: cfg.engine === 'sqlite' ? cfg.path ?? '(default)' : cfg.url ?? '' },
      security: { keyScheme: key.scheme, emailBound: key.emailBound, boundEmail: key.boundEmail },
      desktop: process.env.EDITION === 'community',
    });
  });

  // Validate a candidate metadata-DB engine/URL before the user switches to it.
  // Opens a throwaway connection (no migrations, no effect on the live store).
  // Restricted to the local/community edition — on multi-user web the metadata
  // DB is ops-managed, and a connection probe would be an SSRF vector.
  router.post('/db/test', async (req: Request, res: Response) => {
    if (process.env.EDITION !== 'community') {
      res.status(403).json({ ok: false, error: 'Database engine is managed by the server in this edition.' });
      return;
    }
    const { engine, url, path } = req.body as { engine?: string; url?: string; path?: string };
    if (!engine || !SUPPORTED_ENGINES.includes(engine as DbEngine)) {
      res.status(400).json({ ok: false, error: `Unsupported engine. Supported: ${SUPPORTED_ENGINES.join(', ')}.` });
      return;
    }
    if ((engine === 'postgres' || engine === 'mysql') && !url) {
      res.status(400).json({ ok: false, error: 'A connection string is required.' });
      return;
    }
    let store;
    try {
      store = createMetadataStore({ engine: engine as DbEngine, url, path });
      await store.init();
      res.json({ ok: true });
    } catch (error: unknown) {
      res.json({ ok: false, error: error instanceof Error ? error.message : 'Connection failed' });
    } finally {
      try {
        await store?.close();
      } catch {
        /* ignore */
      }
    }
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
    try {
      const { dialect, option } = await resolveRef((req as AuthedRequest).userId, req.body as ConnectionRef);
      const success = await connectionModule.testConnection(dialect, option);
      res.json({ success, error: success ? undefined : 'Connection test returned false' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/schema/list', async (req: Request, res: Response) => {
    try {
      const { dialect, option } = await resolveRef((req as AuthedRequest).userId, req.body as ConnectionRef);
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
      source: ConnectionRef;
      target: ConnectionRef;
      scope: DbObjectType[];
    };

    try {
      const userId = (req as AuthedRequest).userId;
      const src = await resolveRef(userId, source);
      const tgt = await resolveRef(userId, target);
      // Load both schemas and diff server-side; only the result crosses the wire
      const [sourceTables, targetTables] = await Promise.all([
        loadScopedTables(src.dialect, src.option, src.schema, scope),
        loadScopedTables(tgt.dialect, tgt.option, tgt.schema, scope),
      ]);

      const result = await compareModule.compare(sourceTables, targetTables);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Schema comparison failed';
      res.status(500).json({ error: message });
    }
  });

  router.post('/migration/execute', async (req: Request, res: Response) => {
    const { steps, ...ref } = req.body as ConnectionRef & { steps: MigrationStep[] };
    let dialect: string;
    let option: ConnectionOptions;
    let schema: string;
    try {
      ({ dialect, option, schema } = await resolveRef((req as AuthedRequest).userId, ref));
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid connection' });
      return;
    }

    // Record this run in history (best-effort — never let logging break a deploy).
    const userId = (req as AuthedRequest).userId!;
    const script = steps
      .map((s) => `-- ${s.action} ${s.objectType} ${s.objectName}\n${s.statements.join('\n')}`)
      .join('\n\n');
    let runId: string | null = null;
    try {
      runId = await migrationHistory.start(userId, {
        dialect,
        host: option.host,
        database: option.database,
        schema,
        objectCount: steps.length,
        script,
      });
    } catch {
      /* history is non-critical */
    }

    // Stream NDJSON progress events as the migration runs, while capturing the
    // snapshot, per-object results, and final status for the history record.
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    let snapshotDdl: string | undefined;
    const resultMap = new Map<string, MigrationObjectResult>();
    let finalStatus: MigrationRunStatus = 'FAILED';
    let finalError: string | undefined;
    const send = (event: any) => {
      res.write(JSON.stringify(event) + '\n');
      if (event?.type === 'snapshot') {
        snapshotDdl = event.ddl;
      } else if (event?.type === 'object') {
        // Keep the latest status per object (RUNNING → SUCCESS/FAILED).
        resultMap.set(event.objectName, {
          name: event.objectName,
          type: event.objectType,
          action: event.action,
          status: event.status,
          error: event.error,
        });
      } else if (event?.type === 'done') {
        finalStatus = event.success ? 'SUCCESS' : event.rolledBack ? 'ROLLED_BACK' : 'FAILED';
        finalError = event.error;
      }
    };

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
      finalStatus = 'FAILED';
      finalError = message;
      send({ type: 'done', success: false, rolledBack: false, error: message });
    }

    // Finalize the history record with the outcome.
    if (runId) {
      try {
        await migrationHistory.finish(runId, {
          status: finalStatus,
          results: [...resultMap.values()],
          snapshotDdl,
          error: finalError,
        });
      } catch {
        /* history is non-critical */
      }
    }

    res.end();
  });

  // --- Migration history (per user) ----------------------------------------
  router.get('/migrations', async (req: Request, res: Response) => {
    res.json({ runs: await migrationHistory.list((req as AuthedRequest).userId!) });
  });

  router.get('/migrations/:id', async (req: Request, res: Response) => {
    const run = await migrationHistory.get((req as AuthedRequest).userId!, String(req.params.id));
    if (!run) {
      res.status(404).json({ error: 'Migration run not found' });
      return;
    }
    res.json({ run });
  });

  router.delete('/migrations/:id', async (req: Request, res: Response) => {
    const removed = await migrationHistory.remove((req as AuthedRequest).userId!, String(req.params.id));
    res.status(removed ? 200 : 404).json({ ok: removed });
  });

  return router;
}


