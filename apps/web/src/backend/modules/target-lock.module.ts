/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * One writer at a time per database target.
 *
 * Two people migrating the same schema at once is not a race the database will
 * arbitrate for you: each side planned against a snapshot taken before the
 * other started, so the second migration applies steps derived from a schema
 * that no longer exists. The failure is silent and arrives as a confusing
 * mid-plan error, or worse, a plan that succeeds against the wrong shape.
 *
 * Index maintenance belongs under the same lock. A REORG or REBUILD holds
 * locks on the objects a migration is trying to alter, so running both together
 * turns a deterministic operation into a deadlock race.
 *
 * Scope and honesty about it: this is per-process, in memory. It protects one
 * Fox Schema instance from itself, which is the case that actually happens —
 * a team sharing a deployment. It cannot coordinate two separate deployments
 * pointed at one database; that needs a lock the database itself holds, and
 * saying so here is better than implying a guarantee this does not provide.
 */

export type TargetOperation = 'migrate' | 'index-maintenance' | 'clone';

export interface TargetLockHolder {
  userId: string;
  operation: TargetOperation;
  startedAt: number;
  /** Human label for the message the second caller sees. */
  label: string;
}

export interface TargetLockDenied {
  ok: false;
  heldBy: TargetLockHolder;
  message: string;
}

export interface TargetLockGranted {
  ok: true;
  release: () => void;
}

export type TargetLockResult = TargetLockGranted | TargetLockDenied;

/**
 * Identity of the thing being written to.
 *
 * Host, database and schema — not the connection id, because two saved
 * connections with different credentials can point at the same schema, and
 * that is exactly the collision worth catching.
 */
export function targetKey(target: {
  dialect: string;
  host?: string;
  database?: string;
  schema?: string;
}): string {
  const host = (target.host ?? 'local').toLowerCase();
  const database = (target.database ?? '').toLowerCase();
  const schema = (target.schema ?? '').toLowerCase();
  return `${target.dialect.toLowerCase()}://${host}/${database}/${schema}`;
}

const OPERATION_LABEL: Record<TargetOperation, string> = {
  migrate: 'a migration',
  'index-maintenance': 'index maintenance',
  clone: 'a table clone',
};

/**
 * Long-running work can outlive the request that started it, so a lock left
 * behind by a crashed handler must not block the target forever.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

export class TargetLocks {
  private readonly held = new Map<string, TargetLockHolder>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Take the lock, or explain who has it.
   *
   * Returns rather than throws: the caller decides whether that is a 409 or a
   * queued retry, and a lock module should not assume it is behind HTTP.
   */
  acquire(key: string, holder: Omit<TargetLockHolder, 'startedAt' | 'label'>): TargetLockResult {
    const existing = this.held.get(key);
    if (existing && this.now() - existing.startedAt < STALE_AFTER_MS) {
      const minutes = Math.max(1, Math.round((this.now() - existing.startedAt) / 60000));
      const who = existing.userId === holder.userId ? 'You have' : 'Another user has';
      return {
        ok: false,
        heldBy: existing,
        message: `${who} ${OPERATION_LABEL[existing.operation]} running against this database and schema, started ${minutes} minute${minutes === 1 ? '' : 's'} ago. Wait for it to finish — running both at once can apply changes planned against a schema that has since moved.`,
      };
    }

    const record: TargetLockHolder = {
      ...holder,
      startedAt: this.now(),
      label: OPERATION_LABEL[holder.operation],
    };
    this.held.set(key, record);

    let released = false;
    return {
      ok: true,
      release: () => {
        // Idempotent: a handler that releases in both a catch and a finally
        // must not free a lock someone else has since taken.
        if (released) return;
        released = true;
        if (this.held.get(key) === record) this.held.delete(key);
      },
    };
  }

  /** What is running right now — for the UI's activity toast. */
  active(): Array<TargetLockHolder & { key: string }> {
    const out: Array<TargetLockHolder & { key: string }> = [];
    for (const [key, holder] of this.held) {
      if (this.now() - holder.startedAt >= STALE_AFTER_MS) {
        this.held.delete(key);
        continue;
      }
      out.push({ ...holder, key });
    }
    return out;
  }

  releaseAll(): void {
    this.held.clear();
  }
}

/** The instance the API uses. */
export const targetLocks = new TargetLocks();
