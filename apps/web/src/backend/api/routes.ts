import { Router, Request, Response } from 'express';
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
  sqlStatementCategories,
  statementVerb,
  type MigrationStep,
  type ConnectionOptions,
  type DbObjectType,
  type TableSchema,
  type DbaUtilityKind,
} from '@foxschema/db';
import { probeTableFragmentation, mapPool } from './index-fragmentation';
import { probeDbaUtility } from './dba-utilities';

import { ConnectionStore } from '../modules/connection-store.module';
import { MigrationHistoryStore, type MigrationObjectResult, type MigrationRunStatus } from '../modules/migration-history.module';
import {
  DataMigrateHistoryStore,
  type DataMigrateOpResult,
  type DataMigrateRunStatus,
} from '../modules/data-migrate-history.module';
import { executeDataMigrateOps, type DataMigrateExecOp } from './data-migrate-execute';
import { isSingleSqlStatement } from './single-statement';
import { AppSettingsStore } from '../modules/app-settings.module';
import { LokeeWeaveStore } from '../modules/lokee-weave.module';
import { rateLimit } from './rate-limit';
import {
  runStatements,
  clampMaxRows,
  isRunnableStatement,
  MAX_STATEMENTS,
  MAX_STATEMENT_LENGTH,
} from './sql-execute';
import { clampOffset } from './sql-page-wrap';
import {
  runCodeCellOnServer,
  validateCodeCellRequest,
  type CodeCellRequestBody,
  type CellQueryRunner,
} from './code-cell-execute';
import { makeBeamCellQueryRunner, makeCellQueryRunner } from './code-cell-query';
import { parseBeamEndpoints } from '../../shared/server-beam';
import { getMetadataDbConfig, SUPPORTED_ENGINES, type DbEngine } from '../database/config';
import { createMetadataStore } from '../database/stores/registry';
import { keySchemeInfo } from '../cores/crypto';
import type { AuthedRequest } from './auth.routes';
import { denyUnless, requirePermissions } from './rbac.middleware';
import { isLocalSingleUser } from './deployment';
import { CATEGORY_PERMISSION, DATAGRID_ACTION_PERMISSION, isDatagridAction, permissionSatisfied, type Permission } from '../../shared/permissions';
import { toHttpError, type ActorContext } from '../features/actor';
import { makeConnectionResolver, type ConnectionRef } from '../features/connections/resolve';
import { makeCompareService } from '../features/compare/service';
import {
  applyNpmGlobalUpdate,
  canSelfUpdate,
  checkForUpdate,
  clearUpdateCache,
  MANUAL_UPDATE_COMMAND,
  resolveAppVersion,
  scheduleUiRelaunch,
} from '../modules/updates.module';

// ConnectionRef and its resolution moved to features/connections/resolve.ts so
// services can share them; re-exported here because other modules import it
// from this file.
export type { ConnectionRef };

export function createApiRoutes(connectionModule: ConnectionModule, connectionStore: ConnectionStore): Router {
  const router = Router();
  const compareModule = new CompareModule();
  const migrationModule = new MigrationModule();
  const sqlGenerator = new SqlGeneratorModule();
  const migrationHistory = new MigrationHistoryStore();
  const dataMigrateHistory = new DataMigrateHistoryStore();
  const appSettings = new AppSettingsStore();
  const lokeeWeave = new LokeeWeaveStore();

  // Feature services. These own the business logic and its permission checks;
  // the handlers below are meant to shrink into translation as more move over.
  const resolver = makeConnectionResolver(connectionModule, connectionStore);
  const compareService = makeCompareService({ resolver, compareModule });

  /** Express request → the transport-free ActorContext services are written against. */
  const actorOf = (req: Request): ActorContext => {
    const authed = req as AuthedRequest;
    return {
      userId: authed.userId,
      can: (permission) =>
        authed.appRole === 'admin' ||
        permissionSatisfied(authed.permissions ?? new Set<Permission>(), permission),
    };
  };

  // Single implementation, shared with the feature services. Destructured so the
  // handlers below keep their existing call sites unchanged.
  const { resolveRef, loadScopedTables } = resolver;

  const LOKEE_FULL_SCOPE: DbObjectType[] = [
    'TABLE',
    'MQT',
    'VIEW',
    'FUNCTION',
    'PROCEDURE',
    'TRIGGER',
    'SEQUENCE',
    'TYPE',
  ];

  async function captureLiveSchema(
    userId: string,
    resolved: { dialect: string; option: ConnectionOptions; schema: string },
    source: 'manual' | 'migrate' | 'revert',
    migrationRunId?: string
  ) {
    const { tables } = await loadScopedTables(
      resolved.dialect,
      resolved.option,
      resolved.schema ?? '',
      LOKEE_FULL_SCOPE
    );
    return lokeeWeave.capture(userId, {
      dialect: resolved.dialect,
      host: resolved.option.host ?? null,
      port: resolved.option.port ?? null,
      database: resolved.option.database ?? null,
      schema: resolved.schema ?? null,
      tables,
      source,
      migrationRunId,
    });
  }


  // /health is registered on the public app in server.ts (before auth) and
  // already includes `version` for stale-process detection — do not re-add here.

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
      version: resolveAppVersion(),
      features: { fileQuery: true },
      db: { engine: cfg.engine, location: cfg.engine === 'sqlite' ? cfg.path ?? '(default)' : cfg.url ?? '' },
      security: { keyScheme: key.scheme, emailBound: key.emailBound, boundEmail: key.boundEmail },
    });
  });

  // Validate a candidate metadata-DB engine/URL before the user switches to it.
  // Opens a throwaway connection (no migrations, no effect on the live store).
  // Restricted to the local/community edition — on multi-user web the metadata
  // DB is ops-managed, and a connection probe would be an SSRF vector.
  router.post('/db/test', async (req: Request, res: Response) => {
    // The restriction above was documented but never implemented. On a
    // multi-user deployment this handler dials any host:port the caller names
    // and reports, through the error text, whether something answered — an
    // SSRF and internal port-scan primitive, on a route that carries no
    // permission check. Local single-user is the only place it belongs.
    if (!isLocalSingleUser()) {
      res.status(403).json({
        ok: false,
        error: 'Changing the metadata database is not available on this deployment.',
      });
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

  router.post('/driver/install', async (req: Request, res: Response) => {
    const { dialect } = req.body as { dialect: string };

    try {
      const packageName = DriverDetector.getPackageName(dialect);
      const versionPin = packageName === 'ibm_db' ? '4.0.1' : undefined;

      // Resolve monorepo vs packaged cwd (bundled ui-server used to install into `/`).
      // ibm_db must run install scripts so clidriver downloads + native binding builds.
      const {
        installAndVerifyDriver,
        driverInstallHints,
      } = await import('../modules/driver-install');

      const result = await installAndVerifyDriver(packageName, versionPin);

      if (result.code === null) {
        // npm never started (not on PATH, blocked by policy). The spawn error
        // is the only useful detail; without this it was reported as "install
        // finished but the driver failed to load", which sends the user off
        // debugging the driver instead of their PATH.
        const detail = (result.stderr || result.stdout).trim().slice(-2000);
        res.status(500).json({
          success: false,
          error:
            `Could not run npm for ${packageName}${detail ? `: ${detail}` : ''}. ` +
            `Try it yourself: ${result.manualCommand}. ${driverInstallHints(packageName)}`,
          stderr: result.stderr,
          cwd: result.cwd,
        });
        return;
      }

      if (result.code !== 0) {
        const detail = (result.stderr || result.stdout).trim().slice(-2000);
        res.status(500).json({
          success: false,
          error:
            `npm install ${packageName} failed (exit ${result.code})${detail ? `: ${detail}` : ''}. ` +
            `Try: ${result.manualCommand}. ${driverInstallHints(packageName)}`,
          stderr: result.stderr,
          cwd: result.cwd,
        });
        return;
      }

      if (!result.ok) {
        // npm exited 0 but driver still does not load (scripts skipped / wrong arch).
        res.status(500).json({
          success: false,
          error:
            `Install finished but ${packageName} still failed to load` +
            (result.error ? `: ${result.error}` : '') +
            `. Try: ${result.manualCommand}. ${driverInstallHints(packageName)}` +
            ` Then restart Fox Schema (\`foxschema stop && foxschema\`).`,
          stderr: result.stderr,
          cwd: result.cwd,
        });
        return;
      }

      res.json({
        success: true,
        stdout: result.stdout,
        cwd: result.cwd,
        hint: 'If the driver still shows missing, restart Fox Schema so the process reloads native bindings.',
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
   * One connection ref + kind; dialect probes live in @foxschema/db.
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
    const { statements, maxRows, offset, params, datagridAction, ...ref } = req.body as ConnectionRef & {
      statements?: unknown;
      maxRows?: unknown;
      offset?: unknown;
      params?: unknown;
      /** Data Peek / query-result grid CRUD — requires editor.datagrid.*. */
      datagridAction?: unknown;
    };
    if (!Array.isArray(statements) || statements.length === 0) {
      res.status(400).json({ error: 'statements[] is required.' });
      return;
    }
    const authed = req as AuthedRequest;
    if (denyUnless(authed, res, 'editor.run')) return;
    if (statements.length > MAX_STATEMENTS) {
      res.status(400).json({ error: `At most ${MAX_STATEMENTS} statements per request.` });
      return;
    }
    if (!statements.every(isRunnableStatement)) {
      res.status(400).json({ error: `Every statement must be a non-empty string under ${MAX_STATEMENT_LENGTH} characters.` });
      return;
    }
    // Scan for writes only once the statements are known to be bounded strings.
    // Fail-closed: anything not provably a read needs `editor.write`, so a verb
    // the classifier doesn't recognize is denied instead of executed.
    // Ask for exactly the power each statement needs — data changes, schema
    // changes, or privilege changes — rather than one blanket write bit.
    // Fail-closed: an unrecognized verb classifies as ddl.
    const needed = new Set<Permission>();
    for (const sql of statements as string[]) {
      // Batches inside one string need every category's permission — not just
      // the "broadest" label (CREATE + GRANT is both ddl and grant).
      for (const category of sqlStatementCategories(sql)) {
        const permission = CATEGORY_PERMISSION[category];
        if (permission) needed.add(permission);
      }
    }
    // Grid CRUD also needs the matching Data grid permission so Access control
    // can allow SQL DML without exposing Add/Edit/Delete on Peek / results.
    // Require the SQL verb to match the claimed action so a client cannot label
    // datagridAction=insert while sending UPDATE/DELETE (or DDL).
    if (datagridAction !== undefined) {
      if (!isDatagridAction(datagridAction)) {
        res.status(400).json({ error: 'datagridAction must be insert, update, or delete.' });
        return;
      }
      for (const sql of statements as string[]) {
        // A batch would smuggle a second verb past the per-action permission
        // below — see isSingleSqlStatement.
        if (!isSingleSqlStatement(sql)) {
          res.status(400).json({
            error: 'A Data grid write must be a single statement.',
          });
          return;
        }
        const verb = statementVerb(sql);
        if (verb !== datagridAction) {
          res.status(400).json({
            error: `datagridAction (${datagridAction}) must match SQL verb (${verb ?? 'unknown'}).`,
          });
          return;
        }
      }
      needed.add(DATAGRID_ACTION_PERMISSION[datagridAction]);
    }
    if (needed.size > 0 && denyUnless(authed, res, ...needed)) return;
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
        statements,
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
    const body = req.body as CodeCellRequestBody &
      ConnectionRef & { allowWrites?: boolean; beam?: unknown };
    const authed = req as AuthedRequest;
    if (denyUnless(authed, res, 'editor.advanced')) return;
    // A cell builds its SQL at runtime, so "may write" means it could do either
    // kind of change; require both rather than guessing.
    if (body.allowWrites === true && denyUnless(authed, res, 'editor.dml', 'editor.ddl')) return;
    const validated = validateCodeCellRequest(body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const beamParsed = parseBeamEndpoints(body.beam);
    if (!beamParsed.ok) {
      res.status(400).json({ error: beamParsed.error });
      return;
    }
    try {
      // A cell only gets a `sql` bridge when it was run against a credential
      // (or Server Beam endpoints). Without one it still executes — it just
      // cannot reach a database.
      let dialect: string | undefined;
      let runQuery: CellQueryRunner | undefined;
      let beamDialects: Record<string, string> | undefined;
      let defaultBeamAlias: string | undefined;
      let enforceBeamSqlOnCap = false;
      const granted = authed.permissions ?? new Set<Permission>();
      const policy = {
        allowWrites: body.allowWrites === true,
        can: (permission: Permission) =>
          authed.appRole === 'admin' || permissionSatisfied(granted, permission),
      };

      if (beamParsed.value.length > 0) {
        const userId = (req as AuthedRequest).userId;
        const byAlias = new Map<string, CellQueryRunner>();
        beamDialects = {};
        for (const ep of beamParsed.value) {
          const resolved = await resolveRef(userId, {
            connectionId: ep.connectionId,
            password: ep.password,
          });
          byAlias.set(ep.alias, makeCellQueryRunner(resolved, policy));
          beamDialects[ep.alias] = resolved.dialect;
        }
        defaultBeamAlias = beamParsed.value[0]!.alias;
        dialect = beamDialects[defaultBeamAlias];
        runQuery = makeBeamCellQueryRunner(byAlias, defaultBeamAlias);
        enforceBeamSqlOnCap = true;
      } else if (body.connectionId || (body.dialect && body.option)) {
        const resolved = await resolveRef((req as AuthedRequest).userId, body);
        dialect = resolved.dialect;
        // Per-statement permission check: a cell's SQL is unknown until it
        // runs, so `allowWrites` alone must not be a blanket pass — GRANT still
        // needs `editor.grant`, admin still bypasses as everywhere else.
        runQuery = makeCellQueryRunner(resolved, policy);
      }
      const result = await runCodeCellOnServer(validated.value, {
        dialect,
        allowWrites: body.allowWrites === true,
        runQuery,
        beamDialects,
        defaultBeamAlias,
        enforceBeamSqlOnCap,
      });
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Code cell execution failed';
      res.status(500).json({ error: message });
    }
  });

  // requirePermissions stays for the 401/403 shape the client already expects;
  // the service re-checks so a non-REST caller cannot bypass it.
  router.post('/compare', requirePermissions('schema.compare'), async (req: Request, res: Response) => {
    try {
      const result = await compareService.compare(
        req.body as { source: ConnectionRef; target: ConnectionRef; scope: DbObjectType[] },
        actorOf(req)
      );
      res.json(result);
    } catch (error: unknown) {
      const { status, error: message } = toHttpError(error, 'Schema comparison failed');
      res.status(status).json({ error: message });
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
    let captureAfter = false;
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
        captureAfter = event.success === true;
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

      // Content-addressed Lokee snapshot of the target *before* DDL, so a first
      // migrate still has a baseline version to compare against.
      try {
        const before = await captureLiveSchema(
          userId,
          { dialect, option, schema },
          'migrate',
          runId ?? undefined
        );
        send({ type: 'lokee', phase: 'before', ...before });
      } catch (error: unknown) {
        send({
          type: 'lokee',
          phase: 'before',
          error: error instanceof Error ? error.message : 'Lokee snapshot failed',
        });
      }

      // 2. Execute the plan in a single transaction, reporting per object
      await migrationModule.execute(dialect, option, schema, steps, send, { continueOnError: !!continueOnError });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Migration failed';
      finalStatus = 'FAILED';
      finalError = message;
      send({ type: 'done', success: false, rolledBack: false, error: message });
    }

    if (captureAfter) {
      try {
        const after = await captureLiveSchema(
          userId,
          { dialect, option, schema },
          'migrate',
          runId ?? undefined
        );
        send({ type: 'lokee', phase: 'after', ...after });
      } catch (error: unknown) {
        send({
          type: 'lokee',
          phase: 'after',
          error: error instanceof Error ? error.message : 'Lokee snapshot failed',
        });
      }
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

  // --- Lokee Weave: schema versioning (Compare Schema history) -------------
  //
  // Capture reads the *whole* schema regardless of the compare scope in use.
  // A version that only covered the objects someone happened to be comparing
  // would be a snapshot you cannot safely revert to.
  const lokeeCaptureLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

  router.post(
    '/lokee/capture',
    lokeeCaptureLimiter,
    requirePermissions('schema.browse'),
    async (req: Request, res: Response) => {
      const body = req.body as ConnectionRef & { source?: string; migrationRunId?: string };
      try {
        const resolved = await resolveRef((req as AuthedRequest).userId, body);
        const result = await captureLiveSchema(
          (req as AuthedRequest).userId!,
          resolved,
          body.source === 'migrate' || body.source === 'revert' ? body.source : 'manual',
          body.migrationRunId
        );
        res.json(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to capture schema';
        res.status(500).json({ error: message });
      }
    }
  );

  router.get('/lokee/databases', async (req: Request, res: Response) => {
    res.json({ databases: await lokeeWeave.listDatabases((req as AuthedRequest).userId!) });
  });

  router.get('/lokee/databases/:id/versions', async (req: Request, res: Response) => {
    const versions = await lokeeWeave.listVersions(
      (req as AuthedRequest).userId!,
      String(req.params.id),
      Number(req.query.limit) || 100
    );
    res.json({ versions });
  });

  router.patch(
    '/lokee/databases/:id/versions/:versionId',
    requirePermissions('schema.browse'),
    async (req: Request, res: Response) => {
      const body = req.body as { name?: string | null; description?: string | null };
      const updated = await lokeeWeave.updateVersionMeta(
        (req as AuthedRequest).userId!,
        String(req.params.id),
        String(req.params.versionId),
        {
          name: body.name,
          description: body.description,
        }
      );
      if (!updated) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      res.json({ version: updated });
    }
  );

  router.get('/lokee/databases/:id/graph', async (req: Request, res: Response) => {
    // The store scopes every read to the caller, so an unknown or unowned id
    // returns an empty graph rather than another user's history.
    res.json(
      await lokeeWeave.graph(
        (req as AuthedRequest).userId!,
        String(req.params.id),
        Number(req.query.limit) || 20
      )
    );
  });

  router.get('/lokee/databases/:id/inspect', async (req: Request, res: Response) => {
    const versionId = String(req.query.versionId ?? '').trim();
    const objectKey = String(req.query.objectKey ?? '').trim();
    if (!versionId || !objectKey) {
      res.status(400).json({ error: 'versionId and objectKey are required' });
      return;
    }
    const result = await lokeeWeave.inspectObject(
      (req as AuthedRequest).userId!,
      String(req.params.id),
      versionId,
      objectKey
    );
    if (!result) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    res.json(result);
  });

  // Version-to-version diff, served from the object store — no connection to
  // the compared database is needed or opened.
  router.get('/lokee/databases/:id/compare', async (req: Request, res: Response) => {
    const versionId = String(req.query.versionId ?? '').trim();
    if (!versionId) {
      res.status(400).json({ error: 'versionId is required' });
      return;
    }
    const against = String(req.query.againstVersionId ?? '').trim();
    const result = await lokeeWeave.diffVersions(
      (req as AuthedRequest).userId!,
      String(req.params.id),
      versionId,
      against || undefined
    );
    if (!result) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    res.json(result);
  });

  router.get(
    '/lokee/databases/:id/revert/plan',
    requirePermissions('schema.browse'),
    async (req: Request, res: Response) => {
      const toVersionId = String(req.query.toVersionId ?? '').trim();
      if (!toVersionId) {
        res.status(400).json({ error: 'toVersionId is required' });
        return;
      }
      // Optional selective revert: `?objectKeys=a&objectKeys=b`, or omitted for
      // the whole schema.
      // Absent means "whole schema"; present-but-empty means "nothing", and
      // those must stay distinguishable all the way down.
      const objectKeys =
        req.query.objectKeys === undefined
          ? undefined
          : ([] as string[])
              .concat(req.query.objectKeys as string | string[])
              .map((k) => String(k).trim())
              .filter(Boolean);
      const plan = await lokeeWeave.planRevert(
        (req as AuthedRequest).userId!,
        String(req.params.id),
        toVersionId,
        undefined,
        undefined,
        objectKeys
      );
      if (!plan) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      const { steps: _steps, ...published } = plan;
      res.json(published);
    }
  );

  router.post(
    '/lokee/databases/:id/revert',
    lokeeCaptureLimiter,
    requirePermissions('schema.migrate'),
    async (req: Request, res: Response) => {
      const body = req.body as ConnectionRef & {
        toVersionId?: string;
        confirmLossy?: boolean;
        /** Revert only these objects; omit for the whole schema. */
        objectKeys?: string[];
      };
      const toVersionId = String(body.toVersionId ?? '').trim();
      if (!toVersionId) {
        res.status(400).json({ error: 'toVersionId is required' });
        return;
      }
      let dialect: string;
      let option: ConnectionOptions;
      let schema: string;
      try {
        ({ dialect, option, schema } = await resolveRef((req as AuthedRequest).userId, body));
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid connection' });
        return;
      }

      const userId = (req as AuthedRequest).userId!;
      const databaseId = String(req.params.id);
      // History is keyed by database identity; the execute connection must be
      // that same database or we would apply reverse DDL to the wrong target.
      const identityMatch = await lokeeWeave.matchDatabaseIdentity(userId, databaseId, {
        dialect,
        host: option.host ?? null,
        port: option.port ?? null,
        database: option.database ?? null,
        schema: schema ?? null,
      });
      if (identityMatch === 'not_found') {
        res.status(404).json({ error: 'Database not found' });
        return;
      }
      if (identityMatch === 'mismatch') {
        res.status(409).json({
          ok: false,
          error:
            'The selected connection does not match this schema history. Choose the credential for the same database before reverting.',
          code: 'connection_mismatch',
        });
        return;
      }

      const objectKeys = Array.isArray(body.objectKeys)
        ? body.objectKeys.map((k) => String(k).trim()).filter(Boolean)
        : undefined;
      const plan = await lokeeWeave.planRevert(
        userId,
        databaseId,
        toVersionId,
        dialect,
        schema,
        objectKeys
      );
      if (!plan) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      const { steps, ...published } = plan;
      if (plan.alreadyAtTarget || steps.length === 0) {
        res.json({ ok: true, ...published, alreadyAtTarget: true });
        return;
      }
      if (plan.reversal.risk === 'blocked') {
        res.status(409).json({
          ok: false,
          error: 'This revert is blocked — existing data cannot be converted.',
          code: 'blocked',
          ...published,
        });
        return;
      }
      if (plan.reversal.risk === 'lossy' && body.confirmLossy !== true) {
        res.status(409).json({
          ok: false,
          error: 'This revert destroys data. Confirm to continue.',
          code: 'confirm_lossy',
          ...published,
        });
        return;
      }

      let failed = true;
      let executeError = 'Revert failed';
      try {
        await migrationModule.execute(dialect, option, schema, steps, (event) => {
          if (event.type === 'done') {
            failed = !event.success;
            if (event.error) executeError = event.error;
          }
        });
      } catch (error: unknown) {
        failed = true;
        executeError = error instanceof Error ? error.message : 'Revert failed';
      }
      if (failed) {
        res.status(500).json({ ok: false, error: executeError, ...published });
        return;
      }

      try {
        const capture = await captureLiveSchema(userId, { dialect, option, schema }, 'revert');
        res.json({ ok: true, capture, ...published });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'capture failed';
        res.status(500).json({
          ok: false,
          error: `Schema reverted but capture failed: ${message}`,
          ...published,
        });
      }
    }
  );

  // --- Data migrate apply (transaction / continue-on-error) ----------------
  router.post(
    '/data-migrate/execute',
    requirePermissions('editor.dml'),
    sqlExecuteLimiter,
    async (req: Request, res: Response) => {
      const body = req.body as ConnectionRef & {
        ops?: unknown;
        useTransaction?: unknown;
        continueOnError?: unknown;
      };
      const authed = req as AuthedRequest;
      if (!Array.isArray(body.ops) || body.ops.length === 0) {
        res.status(400).json({ error: 'ops[] is required.' });
        return;
      }
      if (body.ops.length > 500) {
        res.status(400).json({ error: 'At most 500 ops per data migrate.' });
        return;
      }
      const ops: DataMigrateExecOp[] = [];
      const needed = new Set<Permission>(['editor.dml']);
      for (const raw of body.ops) {
        if (!raw || typeof raw !== 'object') {
          res.status(400).json({ error: 'Each op must be an object.' });
          return;
        }
        const o = raw as Record<string, unknown>;
        if (o.op !== 'insert' && o.op !== 'update' && o.op !== 'delete') {
          res.status(400).json({ error: 'op must be insert, update, or delete.' });
          return;
        }
        if (typeof o.key !== 'string' || typeof o.sql !== 'string' || !o.sql.trim()) {
          res.status(400).json({ error: 'Each op needs key and sql.' });
          return;
        }
        if (o.sql.length > MAX_STATEMENT_LENGTH) {
          res.status(400).json({ error: `Each op.sql must be under ${MAX_STATEMENT_LENGTH} characters.` });
          return;
        }
        if (o.params !== undefined && !Array.isArray(o.params)) {
          res.status(400).json({ error: 'op.params must be an array when set.' });
          return;
        }
        // Fail-closed like /sql/execute: classify the SQL itself so a client cannot
        // label op=insert while sending DELETE/DDL/GRANT and bypass finer permissions.
        const categories = sqlStatementCategories(o.sql);
        if (categories.length === 0) {
          res.status(400).json({ error: 'Could not classify op.sql.' });
          return;
        }
        for (const category of categories) {
          const permission = CATEGORY_PERMISSION[category];
          if (permission) needed.add(permission);
          if (category !== 'dml') {
            res.status(400).json({
              error: `Data migrate op.sql must be DML (got ${category}).`,
            });
            return;
          }
        }
        // Same batch-smuggling guard as /sql/execute — see isSingleSqlStatement.
        if (!isSingleSqlStatement(o.sql)) {
          res.status(400).json({ error: 'Each op.sql must be a single statement.' });
          return;
        }
        const verb = statementVerb(o.sql);
        if (verb !== o.op) {
          res.status(400).json({
            error: `op.sql verb (${verb ?? 'unknown'}) must match op (${o.op}).`,
          });
          return;
        }
        needed.add(DATAGRID_ACTION_PERMISSION[o.op]);
        ops.push({
          op: o.op,
          key: o.key,
          sql: o.sql,
          params: Array.isArray(o.params) ? o.params : [],
        });
      }
      if (denyUnless(authed, res, ...needed)) return;

      let resolved;
      try {
        resolved = await resolveRef(authed.userId, body);
      } catch (error: unknown) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Invalid connection',
        });
        return;
      }

      try {
        const out = await executeDataMigrateOps(
          resolved.dialect,
          resolved.option,
          resolved.schema,
          ops,
          {
            useTransaction: body.useTransaction !== false,
            continueOnError: Boolean(body.continueOnError),
          }
        );
        res.json(out);
      } catch (error: unknown) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Data migrate failed',
        });
      }
    }
  );

  // --- Data migrate history (SQL Editor side-by-side row ops) ---------------
  router.get('/data-migrations', requirePermissions('editor.dml'), async (req: Request, res: Response) => {
    res.json({ runs: await dataMigrateHistory.list((req as AuthedRequest).userId!) });
  });

  router.post(
    '/data-migrations/start',
    requirePermissions('editor.dml'),
    async (req: Request, res: Response) => {
      const body = req.body as {
        dialect?: string;
        sourceHost?: string;
        targetHost?: string;
        database?: string;
        schema?: string;
        tableName?: string;
        rowCount?: number;
        opsEnabled?: { insert?: boolean; update?: boolean; delete?: boolean };
        includeIdentity?: boolean;
        keyColumns?: string[];
        script?: string;
        snapshotJson?: string;
      };
      if (!body.dialect || typeof body.script !== 'string') {
        res.status(400).json({ error: 'dialect and script are required' });
        return;
      }
      const id = await dataMigrateHistory.start((req as AuthedRequest).userId!, {
        dialect: body.dialect,
        sourceHost: body.sourceHost,
        targetHost: body.targetHost,
        database: body.database,
        schema: body.schema,
        tableName: body.tableName,
        rowCount: typeof body.rowCount === 'number' ? body.rowCount : 0,
        opsEnabled: {
          insert: Boolean(body.opsEnabled?.insert),
          update: Boolean(body.opsEnabled?.update),
          delete: Boolean(body.opsEnabled?.delete),
        },
        includeIdentity: Boolean(body.includeIdentity),
        keyColumns: Array.isArray(body.keyColumns)
          ? body.keyColumns.filter((k): k is string => typeof k === 'string')
          : [],
        script: body.script,
        snapshotJson: body.snapshotJson,
      });
      res.json({ id });
    }
  );

  router.post(
    '/data-migrations/:id/finish',
    requirePermissions('editor.dml'),
    async (req: Request, res: Response) => {
      const body = req.body as {
        status?: DataMigrateRunStatus;
        results?: DataMigrateOpResult[];
        error?: string;
      };
      const status = body.status;
      if (status !== 'SUCCESS' && status !== 'PARTIAL_SUCCESS' && status !== 'FAILED') {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }
      const run = await dataMigrateHistory.get(
        (req as AuthedRequest).userId!,
        String(req.params.id)
      );
      if (!run) {
        res.status(404).json({ error: 'Data migrate run not found' });
        return;
      }
      await dataMigrateHistory.finish(String(req.params.id), {
        status,
        results: Array.isArray(body.results) ? body.results : [],
        error: body.error,
      });
      res.json({ ok: true });
    }
  );

  router.get(
    '/data-migrations/:id',
    requirePermissions('editor.dml'),
    async (req: Request, res: Response) => {
      const run = await dataMigrateHistory.get(
        (req as AuthedRequest).userId!,
        String(req.params.id)
      );
      if (!run) {
        res.status(404).json({ error: 'Data migrate run not found' });
        return;
      }
      res.json({ run });
    }
  );

  router.delete(
    '/data-migrations/:id',
    requirePermissions('editor.dml'),
    async (req: Request, res: Response) => {
      const removed = await dataMigrateHistory.remove(
        (req as AuthedRequest).userId!,
        String(req.params.id)
      );
      res.status(removed ? 200 : 404).json({ ok: removed });
    }
  );

  return router;
}


