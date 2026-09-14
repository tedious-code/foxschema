/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Routes only the workflow engine calls. They sit outside the user session:
 * the engine runs on a schedule with nobody signed in, so it authenticates
 * with the service token both processes share instead.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import {
  WORKFLOW_CONNECTION_RESOLVE_PATH,
  WORKFLOW_ENGINE_CONFIG_PATH,
  WORKFLOW_ENGINE_TOKEN_ENV,
  WORKFLOW_INTERNAL_PREFIX,
  type EngineRuntimeConfig,
} from '@foxschema/workflow-contract';
import { Router } from '../../platform/http/router';
import { sendError } from '../../platform/http/respond';
import type { AppRequest, NextFunction } from '../../platform/http/types';
import { WorkflowConnectionGrants } from './workflow-connection-grants.service';
import { WorkflowSettingsService } from './workflow-settings.service';

/**
 * Accept only a request that presents the shared token.
 *
 * With no token configured the routes answer 503 rather than opening up: an
 * install that has not set one has not decided to let the engine reach saved
 * connections.
 */
export function engineTokenGuard(token: string | undefined = process.env[WORKFLOW_ENGINE_TOKEN_ENV]) {
  const expected = token ? Buffer.from(token) : undefined;
  return (req: AppRequest, res: FastifyReply, next: NextFunction): void => {
    if (!expected) {
      sendError(res, 'unavailable', `${WORKFLOW_ENGINE_TOKEN_ENV} is not set, so the workflow engine cannot use saved connections`);
      return;
    }
    const header = req.headers.authorization ?? '';
    const presented = Buffer.from(header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '');
    // Compared in constant time; the length check first is required by
    // timingSafeEqual and reveals only the length, which is not the secret.
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      sendError(res, 'unauthenticated', 'Invalid workflow engine token');
      return;
    }
    next();
  };
}

export function createWorkflowInternalRoutes(
  grants: Pick<WorkflowConnectionGrants, 'resolveForEngine'> = new WorkflowConnectionGrants(),
  token?: string,
  settings: Pick<WorkflowSettingsService, 'getConfig'> = new WorkflowSettingsService(),
): Router {
  const router = Router();
  const guard = engineTokenGuard(token);

  // The settings the engine applies itself. The endpoint is left out: it is
  // where FoxSchema finds the engine, which the engine has no use for.
  router.get(
    WORKFLOW_ENGINE_CONFIG_PATH.slice(WORKFLOW_INTERNAL_PREFIX.length),
    guard,
    async (_req: AppRequest, res: FastifyReply) => {
      const { state, maxParallel, sinks } = await settings.getConfig();
      const config: EngineRuntimeConfig = { state, maxParallel, sinks };
      void res.header('cache-control', 'no-store');
      res.send(config);
    },
  );

  router.post(
    WORKFLOW_CONNECTION_RESOLVE_PATH.slice(WORKFLOW_INTERNAL_PREFIX.length),
    guard,
    async (req: AppRequest, res: FastifyReply) => {
      const connectionId = (req.body as { connectionId?: unknown } | undefined)?.connectionId;
      if (typeof connectionId !== 'string' || !connectionId) {
        sendError(res, 'invalid_input', 'connectionId is required');
        return;
      }
      const resolved = await grants.resolveForEngine(connectionId);
      if (!resolved) {
        // One answer for "no such connection" and "not granted": the engine has
        // no business telling the two apart.
        sendError(res, 'not_found', 'This connection is not granted to workflows');
        return;
      }
      void res.header('cache-control', 'no-store');
      res.send(resolved);
    },
  );

  return router;
}
