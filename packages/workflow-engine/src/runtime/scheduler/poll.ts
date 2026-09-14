/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/scheduler/poll.ts).
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  getPath,
  type CredentialStore,
  type TriggerInvocation,
  type TriggerScheduleStore,
  type WorkflowDef,
  type WorkflowStore,
} from '../../common/index.js';
import { executeHttpRequest } from '../../pipes/http/index.js';

/**
 * How many dedup keys a poll trigger remembers.
 *
 * This is the honest limit of the mechanism: keys are remembered as a bounded
 * set rather than a high-water mark, because a dedup key is often an opaque id
 * (a ticket uuid, an order ref) with no ordering to take a mark on. The cost
 * is that an item reappearing after this many *other* items have been seen
 * looks new again. For the shape this trigger is for — "tell me when something
 * arrives" against an endpoint returning tens of items per poll — that is many
 * polls of headroom.
 */
export const POLL_SEEN_KEYS_LIMIT = 1000;

interface PollScheduler {
  enqueue(workflow: WorkflowDef, invocation: TriggerInvocation): Promise<unknown>;
}

export interface PollCoordinatorOptions {
  workflows: WorkflowStore;
  schedules: TriggerScheduleStore;
  scheduler: PollScheduler;
  credentials?: CredentialStore;
  fetch?: typeof fetch;
  now?: () => Date;
  tickIntervalMs?: number;
  onError?: (error: unknown) => void;
}

type PollTrigger = Extract<WorkflowDef['triggers'][number], { kind: 'poll' }>;

/**
 * Calls an endpoint on an interval and creates a run only for items it has not
 * seen before — the pull-shaped sibling of the webhook.
 *
 * Deliberately a separate coordinator from CronCoordinator rather than another
 * `executionType` on cron: a poll decides *whether* to create a run based on
 * what came back, so it owns a cursor and a fetch that cron has no use for,
 * and cron's catch-up semantics are meaningless here (there is no backlog of
 * missed occurrences to replay — there is only "what is there now").
 */
export class PollCoordinator {
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => Date;
  private readonly tickIntervalMs: number;
  private readonly onError: (error: unknown) => void;

  constructor(private readonly options: PollCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.tickIntervalMs = options.tickIntervalMs ?? 30_000;
    this.onError =
      options.onError ??
      ((error) => console.error('[foxagent] poll failed:', error));
  }

  async tick(): Promise<void> {
    const now = this.now();
    const workflows = await this.options.workflows.list();

    for (const workflow of workflows) {
      for (const trigger of workflow.triggers) {
        if (trigger.kind !== 'poll' || !trigger.enabled) continue;
        try {
          await this.pollOne(workflow, trigger, now);
        } catch (error) {
          // One unreachable endpoint must not stall every other poll.
          this.onError(error);
          await this.reschedule(workflow, trigger, now);
        }
      }
    }
    // Reaping is CronCoordinator's job and it reaps by "no longer exists in
    // any workflow", which covers poll rows too. Doing it here as well would
    // be a second writer racing the first for no gain.
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.onError(error));
    }, this.tickIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async pollOne(
    workflow: WorkflowDef,
    trigger: PollTrigger,
    now: Date,
  ): Promise<void> {
    const fingerprint = pollFingerprint(trigger);
    const state = await this.options.schedules.get(workflow.id, trigger.id);

    // A changed request or dedup key invalidates the cursor: keys collected
    // under the old config say nothing about items under the new one.
    if (!state || state.scheduleFingerprint !== fingerprint) {
      await this.options.schedules.put({
        workflowId: workflow.id,
        triggerId: trigger.id,
        nextFireAt: nextFireAt(trigger, now),
        scheduleFingerprint: fingerprint,
      });
      return;
    }
    if (new Date(state.nextFireAt).getTime() > now.getTime()) return;

    const items = await this.fetchItems(trigger);
    const priming = state.seenKeys === undefined;
    const seen = new Set(state.seenKeys ?? []);

    const fresh: unknown[] = [];
    const freshKeys: string[] = [];
    for (const item of items) {
      const key = dedupKeyOf(item, trigger);
      if (seen.has(key)) continue;
      seen.add(key);
      freshKeys.push(key);
      if (fresh.length < trigger.maxItems) fresh.push(item);
    }

    const delivered = freshKeys.slice(0, fresh.length);
    const shouldFire =
      fresh.length > 0 && !(priming && trigger.onFirstPoll === 'prime');

    // Priming records the whole response — marking the backlog "already seen"
    // is the entire point. Any poll that *delivers* records only what actually
    // went out: keys past maxItems must stay new, or those items are dropped
    // without ever reaching a run. A priming poll under `onFirstPoll: 'fire'`
    // delivers, so it takes the delivering path too.
    const carried = shouldFire ? delivered : freshKeys;
    const nextSeen = boundedSeen(state.seenKeys ?? [], carried);

    if (shouldFire) {
      await this.options.scheduler.enqueue(
        workflow,
        pollInvocation(workflow.id, trigger.id, fresh, delivered, now),
      );
    }

    await this.options.schedules.put({
      workflowId: workflow.id,
      triggerId: trigger.id,
      nextFireAt: nextFireAt(trigger, now),
      lastAcceptedAt: shouldFire ? now.toISOString() : state.lastAcceptedAt,
      scheduleFingerprint: fingerprint,
      seenKeys: nextSeen,
    });
  }

  private async fetchItems(trigger: PollTrigger): Promise<unknown[]> {
    const credentialId =
      trigger.http.auth.type === 'credential'
        ? trigger.http.auth.credentialId
        : undefined;
    const secret =
      trigger.http.auth.type === 'credential' && this.options.credentials
        ? await this.options.credentials.revealSecret(
            trigger.http.auth.credentialId,
          )
        : undefined;

    const result = await executeHttpRequest({
      request: trigger.http,
      secret,
      credentialId,
      credentials: this.options.credentials,
      variables: trigger.http.variables,
      trigger: { triggerId: trigger.id, kind: 'poll' },
      fetch: this.options.fetch,
    });
    if (!result.ok) {
      throw new Error(
        `poll ${trigger.id}: endpoint returned ${result.status}`,
      );
    }

    const located = trigger.resultsPath
      ? getPath(result.body, trigger.resultsPath)
      : result.body;
    if (!Array.isArray(located)) {
      // Not "zero items": a path that stops matching is how a poll goes quiet
      // forever without anyone noticing. Fail loudly instead.
      throw new Error(
        `poll ${trigger.id}: resultsPath ${
          trigger.resultsPath ? `'${trigger.resultsPath}'` : '(body)'
        } is ${located === undefined ? 'missing' : 'not an array'}`,
      );
    }
    return located;
  }

  private async reschedule(
    workflow: WorkflowDef,
    trigger: PollTrigger,
    now: Date,
  ): Promise<void> {
    const state = await this.options.schedules.get(workflow.id, trigger.id);
    await this.options.schedules.put({
      workflowId: workflow.id,
      triggerId: trigger.id,
      nextFireAt: nextFireAt(trigger, now),
      lastAcceptedAt: state?.lastAcceptedAt,
      scheduleFingerprint: pollFingerprint(trigger),
      // Preserve the cursor: a failed fetch is not evidence about which items
      // have been delivered.
      seenKeys: state?.seenKeys,
    });
  }
}

function dedupKeyOf(item: unknown, trigger: PollTrigger): string {
  const value = getPath(item, trigger.dedupKey);
  // A missing key would collide every such item into one, dropping all but the
  // first. Hashing the item keeps them distinct and still dedups exact repeats.
  if (value === undefined || value === null) {
    return `sha:${createHash('sha256')
      .update(JSON.stringify(item) ?? 'undefined')
      .digest('hex')}`;
  }
  return String(value);
}

function boundedSeen(previous: string[], added: string[]): string[] {
  const merged = [...previous, ...added];
  return merged.length > POLL_SEEN_KEYS_LIMIT
    ? merged.slice(merged.length - POLL_SEEN_KEYS_LIMIT)
    : merged;
}

function nextFireAt(trigger: PollTrigger, now: Date): string {
  return new Date(now.getTime() + trigger.intervalSeconds * 1_000).toISOString();
}

function pollFingerprint(trigger: PollTrigger): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        http: trigger.http,
        resultsPath: trigger.resultsPath,
        dedupKey: trigger.dedupKey,
        intervalSeconds: trigger.intervalSeconds,
      }),
    )
    .digest('hex');
}

function pollInvocation(
  workflowId: string,
  triggerId: string,
  items: unknown[],
  keys: string[],
  acceptedAt: Date,
): TriggerInvocation {
  // The keys, not the clock, identify this delivery: the same new items must
  // look like the same invocation even if two instances poll a moment apart.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(keys))
    .digest('hex');
  return {
    id: randomUUID(),
    workflowId,
    triggerId,
    kind: 'poll',
    acceptedAt: acceptedAt.toISOString(),
    payload: { items },
    idempotencyKey: `poll:${triggerId}:${fingerprint}`,
    fingerprint,
    metadata: { itemCount: String(items.length) },
  };
}
