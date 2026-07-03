import { Router, Response } from 'express';
import { ConnectionStore } from '../modules/connection-store.module';
import { AuthedRequest } from './auth.routes';

/** CRUD for the signed-in user's saved connections (credentials encrypted at rest). */
export function createConnectionStoreRoutes(store: ConnectionStore): Router {
  const router = Router();

  router.get('/', async (req: AuthedRequest, res: Response) => {
    res.json({ connections: await store.list(req.userId!) });
  });

  router.post('/', async (req: AuthedRequest, res: Response) => {
    const { name, dialect, schema, option, savePassword } = req.body as {
      name?: string;
      dialect?: string;
      schema?: string;
      option?: Record<string, unknown>;
      savePassword?: boolean;
    };
    if (!dialect || !option) {
      res.status(400).json({ error: 'dialect and option are required' });
      return;
    }
    try {
      res.json({ connection: await store.create(req.userId!, { name, dialect, schema, option, savePassword }) });
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save connection' });
    }
  });

  router.put('/:id', async (req: AuthedRequest, res: Response) => {
    const { name, dialect, schema, option, savePassword } = req.body as {
      name?: string;
      dialect?: string;
      schema?: string;
      option?: Record<string, unknown>;
      savePassword?: boolean;
    };
    if (!dialect || !option) {
      res.status(400).json({ error: 'dialect and option are required' });
      return;
    }
    try {
      const updated = await store.update(req.userId!, String(req.params.id), { name, dialect, schema, option, savePassword });
      if (!updated) {
        res.status(404).json({ error: 'Connection not found' });
        return;
      }
      res.json({ connection: updated });
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update connection' });
    }
  });

  router.delete('/:id', async (req: AuthedRequest, res: Response) => {
    const removed = await store.remove(req.userId!, String(req.params.id));
    res.status(removed ? 200 : 404).json({ ok: removed });
  });

  return router;
}
