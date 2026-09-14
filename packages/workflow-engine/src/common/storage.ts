/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/storage.ts).
 */
import type { HumanInputRecord, HumanInputRequest } from './human-input.js';
import type { WorkflowDef } from './definitions/workflow.js';
import type {
  Checkpoint,
  PipeRunRecord,
  PipelineRunRecord,
  RunEvent,
  TriggerInvocation,
  TriggerScheduleState,
  WorkflowRunRecord,
} from './types.js';

/** Listing metadata that isn't part of the workflow definition itself. */
export interface WorkflowSummaryRecord {
  id: string;
  version: number;
  updatedAt: string;
}

export interface WorkflowStore {
  put(workflow: WorkflowDef): Promise<void>;
  get(id: string): Promise<WorkflowDef | undefined>;
  list(): Promise<WorkflowDef[]>;
  /** Stored metadata (updatedAt) that `list()` can't carry on WorkflowDef. */
  summaries(): Promise<WorkflowSummaryRecord[]>;
  /** True when a workflow was deleted; false when it did not exist. */
  remove(id: string): Promise<boolean>;
}

export interface RunStore {
  create(
    run: WorkflowRunRecord,
    snapshot: WorkflowDef,
    invocation?: TriggerInvocation,
  ): Promise<void>;
  /**
   * Create the run only if that workflow has no queued or running one, and
   * report whether this caller won.
   *
   * `onOverlap: 'skip'` is decided by reading the active runs and then
   * inserting. Two schedulers sharing a database both read "none active" and
   * both insert, so a workflow that must not overlap runs twice — the check
   * has to be the write. Optional so an embedder's own store keeps working;
   * absent, the scheduler falls back to the read-then-write it does today and
   * is single-instance only.
   */
  createIfIdle?(
    run: WorkflowRunRecord,
    snapshot: WorkflowDef,
    invocation?: TriggerInvocation,
  ): Promise<boolean>;
  get(id: string): Promise<WorkflowRunRecord | undefined>;
  list(workflowId?: string): Promise<WorkflowRunRecord[]>;
  update(run: WorkflowRunRecord): Promise<void>;
  getSnapshot(id: string): Promise<WorkflowDef | undefined>;
  getInvocation(id: string): Promise<TriggerInvocation | undefined>;
  findByIdempotencyKey(
    workflowId: string,
    triggerId: string,
    idempotencyKey: string,
  ): Promise<WorkflowRunRecord | undefined>;
  putPipeline(record: PipelineRunRecord): Promise<void>;
  listPipelines(workflowRunId: string): Promise<PipelineRunRecord[]>;
  putPipe(record: PipeRunRecord): Promise<void>;
  listPipes(workflowRunId: string, pipelineId?: string): Promise<PipeRunRecord[]>;
  /**
   * Reclaim runs whose owner is gone.
   *
   * With `now`, a live peer's work is left alone: another instance's run is
   * taken only once its lease has lapsed. `instanceId` marks the caller's own
   * runs as always reclaimable — reaching recovery means this process
   * restarted, so waiting out its own lease would stall every crash recovery by
   * the lease length. Without `now`, every running run is reclaimed.
   */
  interruptRunning(
    now?: string,
    instanceId?: string,
  ): Promise<WorkflowRunRecord[]>;
  /** Renew this instance's claim on a run it is still executing. */
  renewLease?(
    runId: string,
    instanceId: string,
    expiresAt: string,
  ): Promise<boolean>;
}

export type NewRunEvent = Omit<RunEvent, 'seq'>;

export interface EventStore {
  append(event: NewRunEvent): Promise<RunEvent>;
  list(workflowRunId: string, afterSeq?: number): Promise<RunEvent[]>;
}

export interface CheckpointStore {
  put(checkpoint: Checkpoint): Promise<void>;
  get(
    workflowRunId: string,
    pipelineId: string,
    pipeId: string,
    partitionId: string,
  ): Promise<Checkpoint | undefined>;
  list(workflowRunId: string): Promise<Checkpoint[]>;
}

export interface TriggerScheduleStore {
  put(state: TriggerScheduleState): Promise<void>;
  get(
    workflowId: string,
    triggerId: string,
  ): Promise<TriggerScheduleState | undefined>;
  list(): Promise<TriggerScheduleState[]>;
  remove(workflowId: string, triggerId: string): Promise<void>;
}

/** A named set of variables (dev / staging / prod). Exactly one is active. */
export interface EnvironmentRecord {
  id: string;
  name: string;
  /** The environment runs use when the caller doesn't name one. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * `global` applies to every workflow in its environment; `workflow` is scoped
 * to one workflow and overrides a global of the same key.
 */
export type VariableScope = 'global' | 'workflow';

export interface VariableRecord {
  id: string;
  environmentId: string;
  scope: VariableScope;
  /** Present only for `scope: 'workflow'`. */
  workflowId?: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface EnvironmentStore {
  list(): Promise<EnvironmentRecord[]>;
  get(id: string): Promise<EnvironmentRecord | undefined>;
  getByName(name: string): Promise<EnvironmentRecord | undefined>;
  active(): Promise<EnvironmentRecord | undefined>;
  create(input: { name: string; isActive?: boolean }): Promise<EnvironmentRecord>;
  rename(id: string, name: string): Promise<EnvironmentRecord | undefined>;
  /** Activate `id` and deactivate the rest, atomically. */
  activate(id: string): Promise<EnvironmentRecord | undefined>;
  remove(id: string): Promise<boolean>;
}

export interface VariableStore {
  list(filter?: {
    environmentId?: string;
    scope?: VariableScope;
    workflowId?: string;
  }): Promise<VariableRecord[]>;
  put(input: {
    environmentId: string;
    scope: VariableScope;
    workflowId?: string;
    key: string;
    value: unknown;
  }): Promise<VariableRecord>;
  remove(id: string): Promise<boolean>;
  /**
   * Effective variables for a run: environment globals, then this workflow's
   * locals on top.
   */
  resolve(
    environmentId: string,
    workflowId: string,
  ): Promise<Record<string, unknown>>;
}

/**
 * Pending questions for a human, and their answers.
 *
 * Separate from `VariableStore` because the lifecycle is different: a variable
 * is configuration that outlives runs, while this is one question asked of one
 * run, valid for minutes. Answers are encrypted at rest — an OTP sitting in
 * plain text in the run database would outlast its usefulness by years.
 */
export interface HumanInputStore {
  /**
   * Record that a run is waiting. Idempotent per (run, key): a pipe that is
   * re-executed before anyone answers must not stack up duplicate questions.
   */
  request(input: {
    workflowRunId: string;
    pipelineId: string;
    pipeId: string;
    request: HumanInputRequest;
    now: string;
  }): Promise<HumanInputRecord>;
  /** Everything this run is still waiting on. */
  pending(workflowRunId: string): Promise<HumanInputRecord[]>;
  get(workflowRunId: string, key: string): Promise<HumanInputRecord | undefined>;
  /** Store an answer and mark the request answered. */
  answer(
    workflowRunId: string,
    key: string,
    values: Record<string, unknown>,
    now: string,
  ): Promise<void>;
  /** The decrypted answer, for the pipe that asked. */
  answerFor(
    workflowRunId: string,
    key: string,
  ): Promise<Record<string, unknown> | undefined>;
  /** Mark anything past its deadline expired, and report what lapsed. */
  expire(now: string): Promise<HumanInputRecord[]>;
}
