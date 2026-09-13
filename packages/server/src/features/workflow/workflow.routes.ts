/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * FoxWorkflow control-plane settings and engine health proxy.
 */
import type { FastifyReply } from 'fastify';
import type { AppRequest } from '../../platform/http/types';
import { Router } from '../../platform/http/router';
import type { AdminConfigPut } from '@foxschema/workflow-contract';
import { requirePermissions } from '../authorization/rbac.guard';
import { sendError } from '../../platform/http/respond';
import { WorkflowSettingsService } from './workflow-settings.service';

export function createWorkflowRoutes(
  settings = new WorkflowSettingsService(),
): Router {
  const router = Router();

  router.get(
    '/settings',
    requirePermissions('workflow.access'),
    async (_req: AppRequest, res: FastifyReply) => {
      res.send({ config: await settings.getConfig() });
    },
  );

  router.put(
    '/settings',
    requirePermissions('workflow.admin'),
    async (req: AppRequest, res: FastifyReply) => {
      const body = (req.body ?? {}) as AdminConfigPut;
      if (body.sinks !== undefined && !Array.isArray(body.sinks)) {
        sendError(res, 'invalid_input', 'sinks must be an array');
        return;
      }
      res.send({ config: await settings.putConfig(body) });
    },
  );

  router.get(
    '/engine/health',
    requirePermissions('workflow.access'),
    async (_req: AppRequest, res: FastifyReply) => {
      res.send(await settings.probeEngineHealth());
    },
  );

  return router;
}
