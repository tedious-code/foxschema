/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Data migration routes. Extracted verbatim from api/routes.ts.
 */
import { Router, type Request, type Response } from 'express';
import { requirePermissions, denyUnless } from '../authorization/rbac.guard';
import type { AuthedRequest } from '../auth/auth.routes';
import type { ConnectionRef } from '../../platform/db/resolve';
import { rateLimit } from '../../platform/guards/rate-limit';
import { MAX_STATEMENT_LENGTH } from '../editor/sql-execute.service';
import type { Permission } from '../../../shared/permissions';
import {
  CATEGORY_PERMISSION,
  DATAGRID_ACTION_PERMISSION,
  isDatagridAction,
  permissionSatisfied,
} from '../../../shared/permissions';
import { sqlStatementCategories, statementVerb } from '@foxschema/sql';
import { isSingleSqlStatement } from '../../api/single-statement';
import { executeDataMigrateOps, type DataMigrateExecOp } from '../../api/data-migrate-execute';
import type {
  DataMigrateOpResult,
  DataMigrateRunStatus,
} from './data-migrate-history.service';

export interface DataMigrateRouteDeps {
  resolveRef: (...args: any[]) => Promise<any>;
  dataMigrateHistory: Record<string, any>;
}

export function createDataMigrateRoutes(deps: DataMigrateRouteDeps): Router {
  const router = Router();
  const sqlExecuteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
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
          const permission = CATEGORY_PERMISSION[category as keyof typeof CATEGORY_PERMISSION];
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
        resolved = await deps.resolveRef(authed.userId, body);
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

  router.get('/data-migrations', requirePermissions('editor.dml'), async (req: Request, res: Response) => {
    res.json({ runs: await deps.dataMigrateHistory.list((req as AuthedRequest).userId!) });
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
      const started = await deps.dataMigrateHistory.start((req as AuthedRequest).userId!, {
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
      res.json(started);
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
      const run = await deps.dataMigrateHistory.get(
        (req as AuthedRequest).userId!,
        String(req.params.id)
      );
      if (!run) {
        res.status(404).json({ error: 'Data migrate run not found' });
        return;
      }
      await deps.dataMigrateHistory.finish(String(req.params.id), {
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
      const run = await deps.dataMigrateHistory.get(
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
      const removed = await deps.dataMigrateHistory.remove(
        (req as AuthedRequest).userId!,
        String(req.params.id)
      );
      res.status(removed ? 200 : 404).json({ ok: removed });
    }
  );

  return router;
}
