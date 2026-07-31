import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConnectionModule,
  CompareModule,
  MigrationModule,
  SqlGeneratorModule,
  DriverDetector,
  buildConnectionString,
  normalizeTableSchemas,
  getProviderSettings,
  dialectSupportsIndexFragmentation,
  buildIndexFragmentationCustomTemplate,
  isWriteStatement,
  type MigrationStep,
  type ConnectionOptions,
  type DbObjectType,
  type TableSchema,
  type DbaUtilityKind,
} from '@foxschema/core';
import { probeTableFragmentation, mapPool } from './index-fragmentation';
import { probeDbaUtility } from './dba-utilities';

// apps/web/src/backend/api → monorepo root (npm workspaces live here)
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
import { ConnectionStore } from '../modules/connection-store.module';
import { MigrationHistoryStore, type MigrationObjectResult, type MigrationRunStatus } from '../modules/migration-history.module';
import { AppSettingsStore } from '../modules/app-settings.module';
import { rateLimit } from './rate-limit';
import { runStatements, clampMaxRows, MAX_STATEMENTS, MAX_STATEMENT_LENGTH } from './sql-execute';
import { clampOffset } from './sql-page-wrap';
import {
  runCodeCellOnServer,
  validateCodeCellRequest,
  type CodeCellRequestBody,
  type CellQueryRunner,
} from './code-cell-execute';
import { makeCellQueryRunner } from './code-cell-query';
import { getMetadataDbConfig, SUPPORTED_ENGINES, type DbEngine } from '../database/config';
import { createMetadataStore } from '../database/stores/registry';
import { keySchemeInfo } from '../cores/crypto';
import type { AuthedRequest } from './auth.routes';
import { denyUnless, requirePermissions } from './rbac.middleware';
import {
  applyNpmGlobalUpdate,
  canSelfUpdate,
  checkForUpdate,
  clearUpdateCache,
  MANUAL_UPDATE_COMMAND,
  scheduleUiRelaunch,
} from '../modules/updates.module';

/**
 * A connection reference: either a saved connection (resolved server-side so the
 * password never leaves the server) or an inline ad-hoc option.
 */
interface ConnectionRef {
  connectionId?: string;
  dialect?: string;
  option?: ConnectionOptions;
  schema?: string;
  /**
   * Session password for a saved connection that was stored WITHOUT its password
   * ("save password" unticked). Supplied per-use, merged into the resolved option,
   * never persisted.
   */
  password?: string;
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
      // Merge a per-session password for connections saved without one, and rebuild the
      // connection string so the driver picks it up. connectionString must be cleared
      // before rebuilding — several dialects' buildConnectionString() honors an existing
      // connectionString verbatim instead of reconstructing it from the fields, which
      // would silently keep the stored (passwordless) string and ignore the merge.
      let option = resolved.option;
      if (ref.password && !option.password) {
        option = { ...option, password: ref.password, connectionString: undefined };
        option.connectionString = buildConnectionString(resolved.dialect, option);
      }
      return { dialect: resolved.dialect, option, schema: ref.schema ?? resolved.schema ?? '' };
    }
    if (!ref.dialect || !ref.option) throw new Error('A connectionId or (dialect + option) is required');
    return { dialect: ref.dialect, option: ref.option, schema: ref.schema ?? '' };
  }

  async function loadScopedTables(
    dialect: string,
    option: ConnectionOptions,
    schema: string,
    scope: DbObjectType[]
  ): Promise<{ tables: TableSchema[]; warnings: string[] }> {
    const provider = connectionModule.getProvider(dialect);
    if (!provider.getTables) {
      throw new Error(`Provider for dialect "${dialect}" does not support table listing`);
    }
    let tables = await provider.getTables(option, schema);
    const warnings: string[] = [];

    // Roles are server-global and need their own (privilege-gated) read. Only
    // fetch them when the user selected the Roles scope, and never let a
    // permission error abort the whole comparison — getRoles degrades to a warning.
    const wantRoles = !scope?.length || scope.includes('ROLE');
    if (wantRoles && provider.getRoles) {
      const { roles, warning } = await provider.getRoles(option, schema);
      tables = tables.concat(roles);
      if (warning) warnings.push(warning);
    }

    const scoped = scope?.length ? tables.filter((t) => scope.includes(t.objectType)) : tables;
    // Upgrade path: older providers / cached shapes may omit FK referencedColumns.
    return { tables: normalizeTableSchemas(scoped), warnings };
  }

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // In-app update check — compares the running version against npm (default).
  router.get('/updates/check', async (_req: Request, res: Response) => {
    res.json(await checkForUpdate());
  });

  // One-click self-update for local npm CLI installs (`foxschema open`).
  // Runs `npm install -g foxschema@latest`, then relaunches the UI server.
  router.post('/updates/apply', async (_req: Request, res: Response) => {
    if (!canSelfUpdate()) {
      res.status(403).json({
        ok: false,
        error:
          'Automatic update is only available for local CLI installs. ' +
          `Run in a terminal: ${MANUAL_UPDATE_COMMAND}`,
        upgradeCommand: MANUAL_UPDATE_COMMAND,
      });
      return;
    }
    const result = await applyNpmGlobalUpdate();
    if (!result.ok) {
      res.status(500).json(result);
      return;
    }
    clearUpdateCache();
    res.json(result);
    // Respond first, then exit + relaunch so the client can start polling.
    scheduleUiRelaunch();
  });

  // First-open email subscriber wizard lives on public /api/signup/* (see
  // signup.routes.ts) so it works before login when AUTH_REQUIRED=true.

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
    });
  });

  // Validate a candidate metadata-DB engine/URL before the user switches to it.
  // Opens a throwaway connection (no migrations, no effect on the live store).
  // Restricted to the local/community edition — on multi-user web the metadata
  // DB is ops-managed, and a connection probe would be an SSRF vector.
  router.post('/db/test', async (req: Request, res: Response) => {
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

      // Use spawn with an explicit argument array instead of exec() with a template
      // string — this prevents shell interpretation of packageName (command injection).
      // packageName is looked up from the fixed adapter registry (never the raw
      // request body), so it's safe to let install scripts run — and ibm_db's
      // postinstall is what actually fetches/wires up the DB2 CLI driver; skipping
      // it left the package installed but non-functional.
      //
      // This monorepo uses npm workspaces (not pnpm). --foreground-scripts is
      // required so ibm_db's installer actually downloads clidriver + builds the
      // native binding (npm may otherwise skip scripts for optional deps).
      const args =
        packageName === 'ibm_db'
          ? ['install', 'ibm_db@4.0.1', '--foreground-scripts', '-w', '@foxschema/web']
          : ['install', packageName, '--foreground-scripts', '-w', '@foxschema/web'];
      const proc = spawn('npm', args, {
        cwd: WORKSPACE_ROOT,
        stdio: 'pipe',
        env: { ...process.env, npm_config_ignore_scripts: '' },
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code: number | null) => {
        if (code !== 0) {
          const detail = (stderr || stdout).trim().slice(-2000);
          res.status(500).json({
            success: false,
            error: `npm install ${packageName} failed (exit ${code})${detail ? `: ${detail}` : ''}`,
            stderr,
          });
          return;
        }
        res.json({ success: true, stdout });
      });
      proc.on('error', (err: Error) => {
        res.status(500).json({
          success: false,
          error: `Failed to run npm (${err.message}). Install manually: npm install ${packageName} --foreground-scripts -w @foxschema/web`,
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
      const { success, version } = await connectionModule.testConnection(dialect, option);
      res.json({ success, version, error: success ? undefined : 'Connection test returned false' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/schema/list', requirePermissions('schema.browse'), async (req: Request, res: Response) => {
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

  // Load a single schema's scoped objects (no comparison) — for the browse/search
  // mode. Uses resolveRef so saved connections work, and applies the object-type
  // scope just like /compare does for each side.
  router.post('/schema/load', requirePermissions('schema.browse'), async (req: Request, res: Response) => {
    const { scope, ...ref } = req.body as ConnectionRef & { scope: DbObjectType[] };
    try {
      const { dialect, option, schema } = await resolveRef((req as AuthedRequest).userId, ref);
      const settings = getProviderSettings(dialect);
      if (settings.schemaRequired && !schema?.trim()) {
        res.status(400).json({
          error: `${settings.label} requires a schema. Load schemas for the connection, then pick one before browsing or editing tables.`,
        });
        return;
      }
      const { tables, warnings } = await loadScopedTables(dialect, option, schema, scope);
      res.json(warnings.length ? { tables, warnings } : { tables });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load schema';
      res.status(500).json({ error: message });
    }
  });

  /**
   * Index fragmentation % for Edit Table (DBA guidance).
   * Tries the dialect default probe first; on failure accepts `customSql`
   * (single SELECT returning index_name + fragmentation_percent).
   */
  const indexFragLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
  router.post(
    '/schema/index-fragmentation',
    indexFragLimiter,
    requirePermissions('utility.access'),
    async (req: Request, res: Response) => {
    const body = req.body as ConnectionRef & {
      table?: unknown;
      schema?: unknown;
      customSql?: unknown;
      preferCustom?: unknown;
    };
    const table = typeof body.table === 'string' ? body.table.trim() : '';
    if (!table) {
      res.status(400).json({ error: 'table is required.' });
      return;
    }
    const customSql = typeof body.customSql === 'string' ? body.customSql.trim() : '';
    const preferCustom = body.preferCustom === true;
    try {
      const resolved = await resolveRef((req as AuthedRequest).userId, body);
      const schema =
        (typeof body.schema === 'string' && body.schema.trim()) || resolved.schema || '';
      const probed = await probeTableFragmentation({
        dialect: resolved.dialect,
        option: resolved.option,
        schema,
        table,
        customSql,
        preferCustom,
      });
      if (!probed.ok) {
        const { status, ...rest } = probed.failure;
        res.status(status).json(rest);
        return;
      }
      res.json(probed.value);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to load index fragmentation';
      res.status(500).json({ error: message });
    }
  });

  /**
   * Batch index fragmentation for Utilities → Index Management.
   * Probes many tables (capped) with bounded concurrency on one connection ref.
   */
  const indexFragBatchLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
  router.post(
    '/schema/index-fragmentation-batch',
    indexFragBatchLimiter,
    requirePermissions('utility.access'),
    async (req: Request, res: Response) => {
      const body = req.body as ConnectionRef & {
        tables?: unknown;
        schema?: unknown;
      };
      const tables = Array.isArray(body.tables)
        ? body.tables
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      if (tables.length === 0) {
        res.status(400).json({ error: 'tables[] is required.' });
        return;
      }
      if (tables.length > 80) {
        res.status(400).json({ error: 'At most 80 tables per batch request.' });
        return;
      }
      try {
        const resolved = await resolveRef((req as AuthedRequest).userId, body);
        const schema =
          (typeof body.schema === 'string' && body.schema.trim()) || resolved.schema || '';
        const support = dialectSupportsIndexFragmentation(resolved.dialect);
        const results = await mapPool(tables, 3, async (table) => {
          const probed = await probeTableFragmentation({
            dialect: resolved.dialect,
            option: resolved.option,
            schema,
            table,
          });
          if (!probed.ok) {
            return {
              table,
              ok: false as const,
              error: probed.failure.error,
              rows: [],
              defrag: {} as Record<string, string[]>,
            };
          }
          return {
            table,
            ok: true as const,
            rows: probed.value.rows,
            defrag: probed.value.defrag,
            mode: probed.value.mode,
            source: probed.value.source,
            warning: probed.value.warning,
          };
        });
        res.json({
          support,
          dialect: resolved.dialect,
          schema,
          results,
          customSqlTemplate: buildIndexFragmentationCustomTemplate({
            dialect: resolved.dialect,
            schema,
            table: tables[0]!,
          }),
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to load index fragmentation batch';
        res.status(500).json({ error: message });
      }
    }
  );

  /**
   * DBA utilities: connection pool, user sessions, system info, object sizes.
   * One connection ref + kind; dialect probes live in @foxschema/core.
   */
  const dbaUtilityLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
  router.post(
    '/schema/dba-utility',
    dbaUtilityLimiter,
    requirePermissions('utility.access'),
    async (req: Request, res: Response) => {
    const body = req.body as ConnectionRef & {
      kind?: unknown;
      schema?: unknown;
    };
    const kindRaw = typeof body.kind === 'string' ? body.kind.trim() : '';
    const allowed: DbaUtilityKind[] = ['pool', 'sessions', 'system', 'sizes'];
    if (!allowed.includes(kindRaw as DbaUtilityKind)) {
      res.status(400).json({ error: 'kind must be one of: pool, sessions, system, sizes.' });
      return;
    }
    const kind = kindRaw as DbaUtilityKind;
    try {
      const resolved = await resolveRef((req as AuthedRequest).userId, body);
      const schema =
        (typeof body.schema === 'string' && body.schema.trim()) || resolved.schema || '';
      const probed = await probeDbaUtility({
        dialect: resolved.dialect,
        option: resolved.option,
        kind,
        schema,
      });
      if (!probed.ok) {
        const { status, ...rest } = probed.failure;
        res.status(status).json(rest);
        return;
      }
      res.json({ ...probed.value, dialect: resolved.dialect, schema });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to run DBA utility';
      res.status(500).json({ error: message });
    }
  });

  // SQL Editor: run ad-hoc statements against ONE credential and return shaped
  // row results. The frontend fans out across selected credentials with one
  // request each. The client splits the buffer (same trust model as
  // /migration/execute's pre-split statements); the server validates shape and
  // caps only. Rate-limited: each call can hold a DB connection for a while.
  const sqlExecuteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
  router.post('/sql/execute', sqlExecuteLimiter, async (req: Request, res: Response) => {
    const { statements, maxRows, offset, params, ...ref } = req.body as ConnectionRef & {
      statements?: unknown;
      maxRows?: unknown;
      offset?: unknown;
      params?: unknown;
    };
    if (!Array.isArray(statements) || statements.length === 0) {
      res.status(400).json({ error: 'statements[] is required.' });
      return;
    }
    const authed = req as AuthedRequest;
    if (denyUnless(authed, res, 'editor.run')) return;
    const writes = (statements as string[]).some((s) => isWriteStatement(s));
    if (writes && denyUnless(authed, res, 'editor.write')) return;
    if (statements.length > MAX_STATEMENTS) {
      res.status(400).json({ error: `At most ${MAX_STATEMENTS} statements per request.` });
      return;
    }
    if (statements.some((s) => typeof s !== 'string' || !s.trim() || s.length > MAX_STATEMENT_LENGTH)) {
      res.status(400).json({ error: `Every statement must be a non-empty string under ${MAX_STATEMENT_LENGTH} characters.` });
      return;
    }
    // Optional bind parameters, one array per statement. Anything else is a
    // client bug — reject rather than silently dropping the values, which would
    // send a statement whose placeholders have nothing to bind to.
    if (params !== undefined && (!Array.isArray(params) || params.some((p) => !Array.isArray(p)))) {
      res.status(400).json({ error: 'params must be an array of arrays (one per statement).' });
      return;
    }
    let resolved;
    try {
      resolved = await resolveRef((req as AuthedRequest).userId, ref);
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid connection' });
      return;
    }
    try {
      // Apply the saved connection's schema (CURRENT SCHEMA / search_path) so
      // unqualified names like ORDERS resolve to DEMO.ORDERS, not USER.ORDERS.
      const results = await runStatements(
        resolved.dialect,
        resolved.option,
        statements as string[],
        clampMaxRows(maxRows),
        resolved.schema,
        clampOffset(offset),
        (params as unknown[][] | undefined) ?? []
      );
      res.json({ results });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Query execution failed';
      res.status(500).json({ error: message });
    }
  });

  // SQL Editor Node code cells (`-- @node` / `-- @nodets`). No DB connection;
  // runs allowlisted JS/TS with fetch in a worker_threads sandbox.
  const codeCellLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
  router.post('/sql/code-cell', codeCellLimiter, async (req: Request, res: Response) => {
    const body = req.body as CodeCellRequestBody & ConnectionRef & { allowWrites?: boolean };
    const authed = req as AuthedRequest;
    if (denyUnless(authed, res, 'editor.advanced')) return;
    if (body.allowWrites === true && denyUnless(authed, res, 'editor.write')) return;
    const validated = validateCodeCellRequest(body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    try {
      // A cell only gets a `sql` bridge when it was run against a credential.
      // Without one it still executes — it just cannot reach a database.
      let dialect: string | undefined;
      let runQuery: CellQueryRunner | undefined;
      if (body.connectionId || (body.dialect && body.option)) {
        const resolved = await resolveRef((req as AuthedRequest).userId, body);
        dialect = resolved.dialect;
        runQuery = makeCellQueryRunner(resolved, body.allowWrites === true);
      }
      const result = await runCodeCellOnServer(validated.value, {
        dialect,
        allowWrites: body.allowWrites === true,
        runQuery,
      });
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Code cell execution failed';
      res.status(500).json({ error: message });
    }
  });

  router.post('/compare', requirePermissions('schema.compare'), async (req: Request, res: Response) => {
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
      const [srcLoad, tgtLoad] = await Promise.all([
        loadScopedTables(src.dialect, src.option, src.schema, scope),
        loadScopedTables(tgt.dialect, tgt.option, tgt.schema, scope),
      ]);

      const result = await compareModule.compare(
        srcLoad.tables,
        tgtLoad.tables,
        { source: src.dialect, target: tgt.dialect },
        { source: src.schema, target: tgt.schema },
      );
      const warnings = [
        ...srcLoad.warnings.map((w) => `Source — ${w}`),
        ...tgtLoad.warnings.map((w) => `Target — ${w}`),
      ];
      res.json(warnings.length ? { ...result, warnings } : result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Schema comparison failed';
      res.status(500).json({ error: message });
    }
  });

  router.post('/migration/execute', requirePermissions('schema.migrate'), async (req: Request, res: Response) => {
    const { steps, continueOnError, ...ref } = req.body as ConnectionRef & { steps: MigrationStep[]; continueOnError?: boolean };
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
        // continueOnError can commit successfully while individual objects failed
        // and were skipped — distinguish that from a clean run for the history log.
        const anyObjectFailed = Array.from(resultMap.values()).some((r) => r.status === 'FAILED');
        finalStatus = event.success
          ? (anyObjectFailed ? 'PARTIAL_SUCCESS' : 'SUCCESS')
          : event.rolledBack ? 'ROLLED_BACK' : 'FAILED';
        finalError = event.error;
      }
    };

    try {
      // 1. Snapshot the target schema DDL before touching anything
      const provider = connectionModule.getProvider(dialect);
      if (provider.getTables) {
        const targetObjects = normalizeTableSchemas(await provider.getTables(option, schema));
        let snapshot = `-- =========================================================================\n`;
        snapshot += `-- Target schema snapshot (pre-migration)\n`;
        snapshot += `-- Schema: ${schema}  |  Taken At: ${new Date().toISOString()}\n`;
        snapshot += `-- =========================================================================\n\n`;
        snapshot += targetObjects.map((t) => sqlGenerator.generateObjectDdl(t)).join('\n');
        send({ type: 'snapshot', ddl: snapshot });
      }

      // 2. Execute the plan in a single transaction, reporting per object
      await migrationModule.execute(dialect, option, schema, steps, send, { continueOnError: !!continueOnError });
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

  // Bulk delete selected runs. Registered before '/migrations/:id' so the
  // literal path isn't captured as an :id.
  router.post('/migrations/delete', async (req: Request, res: Response) => {
    const ids = Array.isArray((req.body as { ids?: unknown }).ids)
      ? ((req.body as { ids: unknown[] }).ids.filter((i) => typeof i === 'string') as string[])
      : [];
    const removed = await migrationHistory.removeMany((req as AuthedRequest).userId!, ids);
    res.json({ removed });
  });

  // Clear the entire history for the user.
  router.delete('/migrations', async (req: Request, res: Response) => {
    const removed = await migrationHistory.clear((req as AuthedRequest).userId!);
    res.json({ removed });
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


