import { Router } from '../../platform/http/router';
import type { HttpResponse } from '../../platform/http/types';
import { ConnectionStore } from './connection-store.service';
import { pruneOrphanFileQueryConnections } from '../files/file-query.service';
import { AuthedRequest } from '../auth/auth.routes';
import { sendError, sendThrown } from '../../platform/http/respond';

/** CRUD for the signed-in user's saved connections (credentials encrypted at rest). */
export function createConnectionStoreRoutes(store: ConnectionStore): Router {
  const router = Router();

  router.get('/', async (req: AuthedRequest, res: HttpResponse) => {
    // Drop stale Query-files workspaces whose temp DB expired — keeps upgrades
    // and long-running sessions free of dead `Files:` credentials.
    await pruneOrphanFileQueryConnections(store, req.userId!).catch(() => undefined);
    res.json({ connections: await store.list(req.userId!) });
  });

  router.post('/', async (req: AuthedRequest, res: HttpResponse) => {
    const { name, dialect, schema, option, savePassword } = req.body as {
      name?: string;
      dialect?: string;
      schema?: string;
      option?: Record<string, unknown>;
      savePassword?: boolean;
    };
    if (!dialect || !option) {
      sendError(res, 'invalid_input', 'dialect and option are required');
      return;
    }
    try {
      res.json({ connection: await store.create(req.userId!, { name, dialect, schema, option, savePassword }) });
    } catch (error: unknown) {
      sendThrown(res, error, 'Failed to save connection');
    }
  });

  router.put('/:id', async (req: AuthedRequest, res: HttpResponse) => {
    const { name, dialect, schema, option, savePassword } = req.body as {
      name?: string;
      dialect?: string;
      schema?: string;
      option?: Record<string, unknown>;
      savePassword?: boolean;
    };
    if (!dialect || !option) {
      sendError(res, 'invalid_input', 'dialect and option are required');
      return;
    }
    try {
      const updated = await store.update(req.userId!, String(req.params.id), { name, dialect, schema, option, savePassword });
      if (!updated) {
        sendError(res, 'not_found', 'Connection not found');
        return;
      }
      res.json({ connection: updated });
    } catch (error: unknown) {
      sendThrown(res, error, 'Failed to update connection');
    }
  });

  router.delete('/:id', async (req: AuthedRequest, res: HttpResponse) => {
    const removed = await store.remove(req.userId!, String(req.params.id));
    if (!removed) {
      sendError(res, 'not_found', 'Saved connection not found');
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
