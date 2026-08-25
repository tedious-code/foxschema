import { Router } from '../../platform/http/router';
import type { HttpResponse } from '../../platform/http/types';
import { AppSecretsStore, type AppSecretInput } from './app-secrets.service';
import {
  CloudProviderCredentialsStore,
  type CloudProviderCredentials,
} from './cloud-provider-credentials.service';
import type { CloudSecretRef } from '../../internal/cloud-secrets';
import { isCloudSecretSource } from '../../internal/cloud-secrets';
import { AuthedRequest } from '../auth/auth.routes';
import { requirePermissions } from '../authorization/rbac.guard';
import { sendError, sendThrown } from '../../platform/http/respond';

function parseSecretBody(body: unknown): Partial<AppSecretInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const cloudRaw = b.cloudRef as Partial<CloudSecretRef> | undefined;
  const cloudRef: CloudSecretRef | undefined =
    cloudRaw && typeof cloudRaw.secretId === 'string'
      ? {
          secretId: cloudRaw.secretId,
          credentialId:
            typeof cloudRaw.credentialId === 'string' ? cloudRaw.credentialId : undefined,
          region: typeof cloudRaw.region === 'string' ? cloudRaw.region : undefined,
          vaultUrl: typeof cloudRaw.vaultUrl === 'string' ? cloudRaw.vaultUrl : undefined,
          version: typeof cloudRaw.version === 'string' ? cloudRaw.version : undefined,
        }
      : undefined;
  return {
    name: typeof b.name === 'string' ? b.name : undefined,
    source:
      b.source === 'local' || b.source === 'aws' || b.source === 'gcp' || b.source === 'azure'
        ? b.source
        : undefined,
    value: typeof b.value === 'string' ? b.value : undefined,
    cloudRef,
  };
}

/** CRUD + resolve for the signed-in user's App Secrets vault + named cloud credentials. */
export function createAppSecretsRoutes(
  store: AppSecretsStore,
  providers = new CloudProviderCredentialsStore()
): Router {
  const router = Router();

  router.get('/', requirePermissions('secrets.view'), async (req: AuthedRequest, res: HttpResponse) => {
    res.json({ secrets: await store.list(req.userId!) });
  });

  router.get('/providers', requirePermissions('secrets.view'), async (req: AuthedRequest, res: HttpResponse) => {
    res.json({ providers: await providers.list(req.userId!) });
  });

  router.post('/providers', requirePermissions('secrets.create'), async (req: AuthedRequest, res: HttpResponse) => {
    const body = (req.body ?? {}) as {
      name?: unknown;
      provider?: unknown;
      credentials?: CloudProviderCredentials;
    };
    const name = typeof body.name === 'string' ? body.name : '';
    const providerRaw = typeof body.provider === 'string' ? body.provider : '';
    if (!isCloudSecretSource(providerRaw)) {
      sendError(res, 'invalid_input', 'provider must be aws, gcp, or azure');
      return;
    }
    if (!body.credentials || typeof body.credentials !== 'object') {
      sendError(res, 'invalid_input', 'credentials object is required');
      return;
    }
    try {
      res.json({
        provider: await providers.create(req.userId!, name, providerRaw, body.credentials),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save provider credentials';
      const status = /require|Invalid|must be|already exists|Unknown/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.put('/providers/:id', requirePermissions('secrets.edit'), async (req: AuthedRequest, res: HttpResponse) => {
    const body = (req.body ?? {}) as {
      name?: unknown;
      credentials?: CloudProviderCredentials;
    };
    try {
      const updated = await providers.update(req.userId!, String(req.params.id), {
        name: typeof body.name === 'string' ? body.name : undefined,
        credentials:
          body.credentials && typeof body.credentials === 'object' ? body.credentials : undefined,
      });
      if (!updated) {
        sendError(res, 'not_found', 'Cloud credential not found');
        return;
      }
      res.json({ provider: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update provider credentials';
      const status = /require|Invalid|must be|already exists/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.delete('/providers/:id', requirePermissions('secrets.delete'), async (req: AuthedRequest, res: HttpResponse) => {
    const removed = await providers.remove(req.userId!, String(req.params.id));
    if (!removed) {
      sendError(res, 'not_found', 'Secret not found');
      return;
    }
    res.json({ ok: true });
  });

  router.post('/', requirePermissions('secrets.create'), async (req: AuthedRequest, res: HttpResponse) => {
    const input = parseSecretBody(req.body);
    if (!input.name || !input.source) {
      sendError(res, 'invalid_input', 'name and source are required');
      return;
    }
    try {
      res.json({
        secret: await store.create(req.userId!, {
          name: input.name,
          source: input.source,
          value: input.value,
          cloudRef: input.cloudRef,
        }),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create secret';
      const status = /already exists|Invalid|require/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.post('/resolve', requirePermissions('secrets.view'), async (req: AuthedRequest, res: HttpResponse) => {
    const names = Array.isArray((req.body as { names?: unknown })?.names)
      ? ((req.body as { names: unknown[] }).names.filter((n) => typeof n === 'string') as string[])
      : undefined;
    try {
      const out = await store.resolve(req.userId!, names);
      res.json(out);
    } catch (error: unknown) {
      sendThrown(res, error, 'Failed to resolve secrets');
    }
  });

  router.put('/:id', requirePermissions('secrets.edit'), async (req: AuthedRequest, res: HttpResponse) => {
    const input = parseSecretBody(req.body);
    try {
      const updated = await store.update(req.userId!, String(req.params.id), input);
      if (!updated) {
        sendError(res, 'not_found', 'Secret not found');
        return;
      }
      res.json({ secret: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update secret';
      const status = /already exists|Invalid|require/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.delete('/:id', requirePermissions('secrets.delete'), async (req: AuthedRequest, res: HttpResponse) => {
    const removed = await store.remove(req.userId!, String(req.params.id));
    if (!removed) {
      sendError(res, 'not_found', 'Secret not found');
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
