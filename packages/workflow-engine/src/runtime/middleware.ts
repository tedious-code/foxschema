/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/middleware.ts).
 */
import type {
  MiddlewareRef,
  PipelineDef,
  TriggerInvocation,
  WorkflowDef,
  WorkflowRunRecord,
} from '../common/index.js';

/**
 * Control-plane middleware tiers (docs/engine-evolution.md):
 *
 *   engine   → wraps LocalRunScheduler admission (may reject before a run exists)
 *   workflow → wraps WorkflowRunner's execution phase
 *   pipeline → wraps PipelineExecutor.execute per pipeline
 *
 * There is deliberately no pipe tier — retry/onError/events cover pipe-level
 * cross-cutting. Middleware never touches the batch stream and is not a
 * second path to secrets.
 */
export type MiddlewareTier = 'engine' | 'workflow' | 'pipeline';

export interface MiddlewareContext {
  tier: MiddlewareTier;
  workflow: WorkflowDef;
  /** Per-workflow config from the `middleware: [{ name, config }]` reference. */
  config: Record<string, unknown>;
  invocation?: TriggerInvocation;
  /** Present on the workflow and pipeline tiers. */
  run?: WorkflowRunRecord;
  /** Present on the pipeline tier. */
  pipeline?: PipelineDef;
}

/**
 * Onion-style handler. Call `next()` to continue; throw to reject. Returning
 * without doing either is treated as a bug (silent short-circuits violate the
 * nothing-silent rule) and fails the chain.
 */
export type Middleware = (
  context: MiddlewareContext,
  next: () => Promise<void>,
) => Promise<void>;

export interface ResolvedMiddleware {
  name: string;
  middleware: Middleware;
  config: Record<string, unknown>;
}

const ALL_TIERS: readonly MiddlewareTier[] = ['engine', 'workflow', 'pipeline'];

/**
 * Middleware is registered by name and referenced by name from workflow
 * documents — never by function. Workflow definitions are durable and
 * snapshotted; a closure cannot be persisted or survive crash recovery.
 */
export class MiddlewareRegistry {
  private readonly entries = new Map<
    string,
    { middleware: Middleware; tiers: ReadonlySet<MiddlewareTier> }
  >();

  register(
    name: string,
    middleware: Middleware,
    options?: { tiers?: MiddlewareTier[] },
  ): void {
    if (this.entries.has(name)) {
      throw new Error(`middleware already registered: ${name}`);
    }
    this.entries.set(name, {
      middleware,
      tiers: new Set(options?.tiers ?? ALL_TIERS),
    });
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Registered middleware for discovery (designer picker, diagnostics). */
  list(): Array<{ name: string; tiers: MiddlewareTier[] }> {
    return [...this.entries.entries()].map(([name, entry]) => ({
      name,
      tiers: ALL_TIERS.filter((tier) => entry.tiers.has(tier)),
    }));
  }

  /** Resolve a workflow's references for one tier, in declaration order. */
  resolve(refs: MiddlewareRef[], tier: MiddlewareTier): ResolvedMiddleware[] {
    const resolved: ResolvedMiddleware[] = [];
    for (const ref of refs) {
      const entry = this.entries.get(ref.name);
      if (!entry) throw new Error(`middleware not registered: ${ref.name}`);
      if (!entry.tiers.has(tier)) continue;
      resolved.push({
        name: ref.name,
        middleware: entry.middleware,
        config: ref.config,
      });
    }
    return resolved;
  }
}

/**
 * Run `base` through the resolved chain (first entry outermost). Throws if
 * the chain finishes without `base` having run and without an error — a
 * middleware must call `next()` or throw, never silently swallow the run.
 */
export async function runMiddlewareChain(
  entries: ResolvedMiddleware[],
  context: Omit<MiddlewareContext, 'config'>,
  base: () => Promise<void>,
): Promise<void> {
  if (entries.length === 0) {
    await base();
    return;
  }
  let baseRan = false;
  const chain = entries.reduceRight<() => Promise<void>>(
    (next, entry) => () =>
      entry.middleware({ ...context, config: entry.config }, next),
    async () => {
      baseRan = true;
      await base();
    },
  );
  await chain();
  if (!baseRan) {
    throw new Error(
      `middleware short-circuited without an error: ${entries
        .map((entry) => entry.name)
        .join(', ')}`,
    );
  }
}
