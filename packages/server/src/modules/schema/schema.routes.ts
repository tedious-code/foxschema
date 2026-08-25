/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Schema browse routes. Extracted verbatim from api/routes.ts.
 */
import { Router } from '../../platform/http/router';
import type { HttpRequest, HttpResponse } from '../../platform/http/types';
import { requirePermissions } from '../authorization/rbac.guard';
import type { AuthedRequest } from '../auth/auth.routes';
import type { ConnectionRef } from '../../platform/db/resolve';
import { getProviderSettings, type DbObjectType } from '@foxschema/db';
import { sendError, sendThrown } from '../../platform/http/respond';

export interface SchemaRouteDeps {
  resolveRef: (...args: any[]) => Promise<any>;
  connectionModule: Record<string, any>;
  loadScopedTables: (...args: any[]) => Promise<any>;
}

export function createSchemaRoutes(deps: SchemaRouteDeps): Router {
  const router = Router();
  router.post('/schema/list', requirePermissions('schema.browse'), async (req: HttpRequest, res: HttpResponse) => {
    try {
      const { dialect, option } = await deps.resolveRef((req as AuthedRequest).userId, req.body as ConnectionRef);
      const provider = deps.connectionModule.getProvider(dialect);
      if (!provider.listSchemas) {
        throw new Error(`Provider for dialect "${dialect}" does not support schema listing`);
      }
      const schemas = await provider.listSchemas(option);
      res.json({ schemas });
    } catch (error: unknown) {
      sendThrown(res, error, 'Failed to list schemas');
    }
  });

  router.post('/schema/load', requirePermissions('schema.browse'), async (req: HttpRequest, res: HttpResponse) => {
    const { scope, ...ref } = req.body as ConnectionRef & { scope: DbObjectType[] };
    try {
      const { dialect, option, schema } = await deps.resolveRef((req as AuthedRequest).userId, ref);
      const settings = getProviderSettings(dialect);
      if (settings.schemaRequired && !schema?.trim()) {
        sendError(res, 'invalid_input', `${settings.label} requires a schema. Load schemas for the connection, then pick one before browsing or editing tables.`);
        return;
      }
      const { tables, warnings } = await deps.loadScopedTables(dialect, option, schema, scope);
      res.json(warnings.length ? { tables, warnings } : { tables });
    } catch (error: unknown) {
      sendThrown(res, error, 'Failed to load schema');
    }
  });

  return router;
}
