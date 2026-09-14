/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (apps/api/src/app.ts).
 */
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import rawBody from 'fastify-raw-body';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from './zod-provider.js';
import { createContext, loadConfiguredPlugins, type AppContext } from './context.js';
import { middlewareRoutes } from './routes/middleware.js';
import { pipeRoutes } from './routes/pipes.js';
import { previewRoutes } from './routes/preview.js';
import { credentialRoutes } from './routes/credentials.js';
import { runRoutes } from './routes/runs.js';
import { triggerRoutes } from './routes/triggers.js';
import { variableRoutes } from './routes/variables.js';
import { workflowRoutes } from './routes/workflows.js';

/**
 * Build the Fastify app with zod as the validation + serialization provider.
 * Accepts a context for tests (inject in-memory stores); defaults to a fresh
 * one in production.
 */
export function buildApp(ctx: AppContext = createContext()): FastifyInstance {
  const app = Fastify({
    logger: false,
    trustProxy: process.env.FOXFLOW_TRUST_PROXY === 'true',
    // The run-event SSE endpoint hijacks the reply and never ends its
    // response, so it is never "idle" — Fastify's default ('idle') would wait
    // on it forever and `app.close()` would hang until the supervisor SIGKILLs.
    forceCloseConnections: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(rateLimit, { global: false });
  app.register(rawBody, { global: false, encoding: false, runFirst: true });

  app.get('/health', async () => ({ ok: true, service: 'workflow-server' }));

  app.register(credentialRoutes(ctx), { prefix: '/api' });
  app.register(pipeRoutes(ctx), { prefix: '/api' });
  app.register(previewRoutes(), { prefix: '/api' });
  app.register(middlewareRoutes(ctx), { prefix: '/api' });
  app.register(workflowRoutes(ctx), { prefix: '/api' });
  app.register(runRoutes(ctx), { prefix: '/api' });
  app.register(triggerRoutes(ctx), { prefix: '/api' });
  app.register(variableRoutes(ctx), { prefix: '/api' });
  app.addHook('onReady', async () => {
    await loadConfiguredPlugins(ctx.registry);
    await ctx.scheduler.recover();
    await ctx.cron.recover();
    ctx.cron.start();
    // No recover() equivalent: a poll has no backlog of missed occurrences to
    // replay. Whatever the endpoint holds now is what the first tick sees.
    ctx.poll.start();
  });
  app.addHook('onClose', async () => {
    ctx.cron.stop();
    ctx.poll.stop();
    // Bounded: a wedged run (e.g. a sub-workflow waiting on a child that never
    // reaches a terminal state) must not block shutdown indefinitely.
    await Promise.race([
      ctx.scheduler.idle(),
      new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]);
    ctx.close?.();
  });


  return app;
}
