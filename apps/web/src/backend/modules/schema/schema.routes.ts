/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Schema browse routes. Extracted verbatim from api/routes.ts.
 */
import { Router, type Request, type Response } from 'express';
import { requirePermissions } from '../authorization/rbac.guard';
import type { AuthedRequest } from '../auth/auth.routes';
import type { ConnectionRef } from '../../platform/db/resolve';
import { getProviderSettings, type DbObjectType } from '@foxschema/db';

export interface SchemaRouteDeps {
  resolveRef: (...args: any[]) => Promise<any>;
  connectionModule: Record<string, any>;
  loadScopedTables: (...args: any[]) => Promise<any>;
}

export function createSchemaRoutes(deps: SchemaRouteDeps): Router {
  const router = Router();
  router.post('/schema/list', requirePermissions('schema.browse'), async (req: Request, res: Response) => {
    try {
      const { dialect, option } = await deps.resolveRef((req as AuthedRequest).userId, req.body as ConnectionRef);
      const provider = deps.connectionModule.getProvider(dialect);
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

  router.post('/schema/load', requirePermissions('schema.browse'), async (req: Request, res: Response) => {
    const { scope, ...ref } = req.body as ConnectionRef & { scope: DbObjectType[] };
    try {
      const { dialect, option, schema } = await deps.resolveRef((req as AuthedRequest).userId, ref);
      const settings = getProviderSettings(dialect);
      if (settings.schemaRequired && !schema?.trim()) {
        res.status(400).json({
          error: `${settings.label} requires a schema. Load schemas for the connection, then pick one before browsing or editing tables.`,
        });
        return;
      }
      const { tables, warnings } = await deps.loadScopedTables(dialect, option, schema, scope);
      res.json(warnings.length ? { tables, warnings } : { tables });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load schema';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
