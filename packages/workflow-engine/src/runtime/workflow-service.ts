/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/workflow-service.ts).
 */
import type {
  EventStore,
  RunStore,
  TriggerInvocation,
  WorkflowCallResult,
  WorkflowDef,
  WorkflowRunRecord,
  WorkflowService,
  WorkflowStore,
} from '../common/index.js';
import { RUN_OUTPUT_EVENT, type EnqueueResult } from './workflow.js';

interface RunDispatcher {
  enqueue(
    workflow: WorkflowDef,
    invocation?: TriggerInvocation,
    options?: { parentRunId?: string; environment?: string; debug?: boolean },
  ): Promise<EnqueueResult>;
}

export interface WorkflowServiceFactoryOptions {
  /** Usually the LocalRunScheduler; injected lazily to break construction cycles. */
  dispatcher: RunDispatcher;
  workflows: WorkflowStore;
  runs: RunStore;
  /**
   * Read-side for the child's output. The run's answer lives in its event log
   * (the same place `?wait=` reads it from), so returning it needs no second
   * storage path.
   */
  events?: Pick<EventStore, 'list'>;
  /** Backstop for anything graph analysis misses. Default 16. */
  maxDepth?: number;
  pollIntervalMs?: number;
  now?: () => string;
}

const TERMINAL: ReadonlySet<WorkflowRunRecord['status']> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

/**
 * Per-run sub-workflow dispatch — layer 3 of circular detection
 * (docs/engine-evolution.md): before dispatching, the target is checked
 * against the caller's ancestor chain (walked via persisted `parentRunId`),
 * which catches dynamic ids and version drift that static analysis cannot.
 * Cycles are detected on workflow id, never id@version.
 */
export function createWorkflowServiceFactory(
  options: WorkflowServiceFactoryOptions,
): (
  run: Pick<
    WorkflowRunRecord,
    'id' | 'workflowId' | 'environmentId' | 'debug'
  >,
) => WorkflowService {
  const maxDepth = options.maxDepth ?? 16;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const now = options.now ?? (() => new Date().toISOString());

  return (run) => ({
    async call(workflowId, payload, callOptions): Promise<WorkflowCallResult> {
      // Root-first chain of workflow ids ending at the calling run.
      const chain = await ancestorChain(options.runs, run);
      if (chain.includes(workflowId)) {
        throw new Error(
          `Circular Workflow Dependency: ${[...chain, workflowId].join(' → ')}`,
        );
      }
      if (chain.length >= maxDepth) {
        throw new Error(
          `workflow nesting exceeds max depth ${maxDepth}: ${chain.join(' → ')}`,
        );
      }

      const workflow = await options.workflows.get(workflowId);
      if (!workflow) throw new Error(`workflow not found: ${workflowId}`);
      if (
        callOptions?.workflowVersion !== undefined &&
        workflow.version !== callOptions.workflowVersion
      ) {
        throw new Error(
          `workflow ${workflowId} version ${callOptions.workflowVersion} is not available (latest is ${workflow.version}); re-pin or restore that revision`,
        );
      }
      const trigger = workflow.triggers.find(
        (candidate) => candidate.kind === 'parent' && candidate.enabled,
      );
      if (!trigger || trigger.kind !== 'parent') {
        throw new Error(
          `workflow ${workflowId} has no enabled parent trigger for sub-workflow dispatch`,
        );
      }
      if (
        trigger.allowFrom.length > 0 &&
        !trigger.allowFrom.includes(run.workflowId)
      ) {
        throw new Error(
          `workflow ${workflowId} parent trigger does not allow calls from ${run.workflowId}`,
        );
      }

      const invocation: TriggerInvocation = {
        id: crypto.randomUUID(),
        workflowId,
        triggerId: trigger.id,
        kind: 'parent',
        acceptedAt: now(),
        ...(payload !== undefined ? { payload } : {}),
        metadata: { parentRunId: run.id },
      };
      const result = await options.dispatcher.enqueue(workflow, invocation, {
        parentRunId: run.id,
        // Child runs resolve variables in the SAME environment as their
        // parent — otherwise a run overridden to prod would dispatch children
        // against whatever environment happens to be active.
        ...(run.environmentId ? { environment: run.environmentId } : {}),
        // Debug capture likewise follows the parent: a designer debug run must
        // show samples for the sub-workflow's pipes too, not stop at the call.
        ...(run.debug ? { debug: true } : {}),
      });
      if (!result.accepted) {
        throw new Error(
          `sub-workflow ${workflowId} not accepted${result.reason ? ` (${result.reason})` : ''}`,
        );
      }

      const finished = await waitForTerminal(
        options.runs,
        result.run!.id,
        pollIntervalMs,
        callOptions?.signal,
      );
      return {
        runId: finished.id,
        status: finished.status,
        output: await collectOutput(options.events, finished.id),
      };
    },
  });
}

/**
 * The child's answer, from its run.output event. Absent event, absent store,
 * or a child that collected nothing all mean the same thing to a caller, so
 * they all produce an empty list rather than three shades of undefined.
 */
async function collectOutput(
  events: Pick<EventStore, 'list'> | undefined,
  runId: string,
): Promise<Record<string, unknown>[]> {
  if (!events) return [];
  const log = await events.list(runId);
  const output = log.find((event) => event.type === RUN_OUTPUT_EVENT);
  const records = output?.data?.records;
  return Array.isArray(records) ? (records as Record<string, unknown>[]) : [];
}

/** Workflow ids from the root run down to (and including) `run`. */
async function ancestorChain(
  runs: RunStore,
  run: Pick<WorkflowRunRecord, 'id' | 'workflowId'>,
): Promise<string[]> {
  const chain = [run.workflowId];
  let cursor = await runs.get(run.id);
  let hops = 0;
  while (cursor?.parentRunId) {
    if (++hops > 64) throw new Error('workflow ancestor chain too deep');
    cursor = await runs.get(cursor.parentRunId);
    if (!cursor) break;
    chain.unshift(cursor.workflowId);
  }
  return chain;
}

async function waitForTerminal(
  runs: RunStore,
  runId: string,
  pollIntervalMs: number,
  signal?: AbortSignal,
): Promise<WorkflowRunRecord> {
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException('sub-workflow wait aborted', 'AbortError');
    }
    const run = await runs.get(runId);
    if (run && TERMINAL.has(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
