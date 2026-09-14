/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/builtin-middleware.ts).
 */
import { MiddlewareRegistry, type Middleware } from './middleware.js';

/**
 * Reference middleware: logs each tier transition to the console. Control
 * plane only — it sees workflow/run/pipeline ids and durations, never records
 * or credentials. Config: `{ "prefix": "..." }` (default "foxagent").
 */
export const logMiddleware: Middleware = async (context, next) => {
  const prefix =
    typeof context.config.prefix === 'string' ? context.config.prefix : 'foxagent';
  const scope = [
    context.workflow.id,
    context.run?.id,
    context.pipeline?.id,
  ]
    .filter(Boolean)
    .join(' ');
  const startedAt = Date.now();
  console.log(`[${prefix}] ${context.tier} start ${scope}`);
  try {
    await next();
    console.log(
      `[${prefix}] ${context.tier} ok ${scope} (${Date.now() - startedAt}ms)`,
    );
  } catch (error) {
    console.log(
      `[${prefix}] ${context.tier} failed ${scope} (${Date.now() - startedAt}ms): ${
        (error as Error).message
      }`,
    );
    throw error;
  }
};

/** The middleware registry embedders get when they don't bring their own. */
export function createDefaultMiddlewareRegistry(): MiddlewareRegistry {
  const registry = new MiddlewareRegistry();
  registry.register('log', logMiddleware);
  return registry;
}
