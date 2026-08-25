/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQL Editor routes: statement execution and code cells.
 *
 * Extracted verbatim from api/routes.ts; handler bodies are unchanged.
 */
import { Router, type Request, type Response } from 'express';
import { requirePermissions, denyUnless } from '../authorization/rbac.guard';
import { rateLimit } from '../../platform/guards/rate-limit';
import { idempotency } from '../../platform/guards/idempotency';
import type { AuthedRequest } from '../auth/auth.routes';
import type { ConnectionRef } from '../../platform/db/resolve';
import {
  CATEGORY_PERMISSION,
  DATAGRID_ACTION_PERMISSION,
  isDatagridAction,
  type Permission,
} from '../../../shared/permissions';
import { sqlStatementCategories, statementVerb } from '@foxschema/sql';
import { isSingleSqlStatement } from '../../api/single-statement';
import { permissionSatisfied } from '../../../shared/permissions';
import { clampOffset } from './sql-page-wrap.service';
import { makeBeamCellQueryRunner, makeCellQueryRunner } from './code-cell-query.service';
import type { CellQueryRunner } from './code-cell-execute.service';
import { parseBeamEndpoints } from '../../../shared/server-beam';
import type { CodeCellRequestBody } from './code-cell-execute.service';
import { validateCodeCellRequest } from './code-cell-execute.service';
import { runStatements, clampMaxRows } from './sql-execute.service';
import { runCodeCellOnServer } from './code-cell-execute.service';

export interface EditorRouteDeps {
  resolveRef: (...args: any[]) => Promise<any>;
  MAX_STATEMENTS: number;
  MAX_STATEMENT_LENGTH: number;
  isRunnableStatement: (s: unknown) => boolean;
}

export function createEditorRoutes(deps: EditorRouteDeps): Router {
  const router = Router();
  const sqlExecuteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
  const codeCellLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
  // `idempotency` is a factory, not the middleware. Passing the factory itself
  // made Express call it with (req, res, next); it returned a handler and never
  // called next(), so the request hung with no error and no response.
  const writeIdempotency = idempotency();
  router.post('/sql/execute', sqlExecuteLimiter, writeIdempotency, async (req: Request, res: Response) => {
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
    if (statements.length > deps.MAX_STATEMENTS) {
      res.status(400).json({ error: `At most ${deps.MAX_STATEMENTS} statements per request.` });
      return;
    }
    if (!statements.every(deps.isRunnableStatement)) {
      res.status(400).json({ error: `Every statement must be a non-empty string under ${deps.MAX_STATEMENT_LENGTH} characters.` });
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
      resolved = await deps.resolveRef((req as AuthedRequest).userId, ref);
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
          const resolved = await deps.resolveRef(userId, {
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
        const resolved = await deps.resolveRef((req as AuthedRequest).userId, body);
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

  return router;
}
