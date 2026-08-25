import { describe, it, expect } from 'vitest';
import { describeAge, TargetLocks, targetKey } from './target-lock';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const target = { dialect: 'postgres', host: 'db', database: 'app', schema: 'public' };

describe('targetKey', () => {
  it('identifies the schema, not the saved connection', () => {
    // Two credentials pointing at one schema is exactly the collision worth
    // catching, so the key must not include the connection id.
    expect(targetKey(target)).toBe(targetKey({ ...target }));
    expect(targetKey(target)).not.toMatch(/conn|password/);
  });

  it('is case-insensitive', () => {
    expect(targetKey({ ...target, host: 'DB', schema: 'PUBLIC' })).toBe(targetKey(target));
  });

  it('separates schemas in the same database', () => {
    expect(targetKey({ ...target, schema: 'other' })).not.toBe(targetKey(target));
  });
});

describe('one writer per target', () => {
  it('grants the first caller', () => {
    const locks = new TargetLocks();
    expect(locks.acquire('t', { userId: 'u1', operation: 'migrate' }).ok).toBe(true);
  });

  it('refuses a second migration and names who is running one', () => {
    const locks = new TargetLocks();
    locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    const second = locks.acquire('t', { userId: 'u2', operation: 'migrate' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.message).toMatch(/Another user has a migration running/);
    expect(second.heldBy.userId).toBe('u1');
  });

  it('tells you when it is your own run blocking you', () => {
    // A second browser tab is the common case; "another user" would be wrong.
    const locks = new TargetLocks();
    locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    const again = locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.message).toMatch(/^You have/);
  });

  it('blocks index maintenance while a migration runs, and the reverse', () => {
    // Both take locks on the same objects; together they deadlock.
    const locks = new TargetLocks();
    locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    expect(locks.acquire('t', { userId: 'u2', operation: 'index-maintenance' }).ok).toBe(false);

    const other = new TargetLocks();
    other.acquire('t', { userId: 'u1', operation: 'index-maintenance' });
    const denied = other.acquire('t', { userId: 'u2', operation: 'migrate' });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.message).toMatch(/index maintenance/);
  });

  it('lets a different target through untouched', () => {
    const locks = new TargetLocks();
    locks.acquire('a', { userId: 'u1', operation: 'migrate' });
    expect(locks.acquire('b', { userId: 'u2', operation: 'migrate' }).ok).toBe(true);
  });

  it('frees the target on release', () => {
    const locks = new TargetLocks();
    const first = locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    if (!first.ok) throw new Error('expected grant');
    first.release();
    expect(locks.acquire('t', { userId: 'u2', operation: 'migrate' }).ok).toBe(true);
  });

  it('release is idempotent — it must not free someone else’s lock', () => {
    // A handler releasing in both catch and finally would otherwise unlock a
    // migration that started in between.
    const locks = new TargetLocks();
    const first = locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    if (!first.ok) throw new Error('expected grant');
    first.release();
    const second = locks.acquire('t', { userId: 'u2', operation: 'migrate' });
    first.release();
    expect(second.ok).toBe(true);
    // u2 still holds it.
    expect(locks.acquire('t', { userId: 'u3', operation: 'migrate' }).ok).toBe(false);
  });

  it('expires a lock left behind by a crashed handler', () => {
    const c = clock();
    const locks = new TargetLocks(c.now);
    locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    c.advance(29 * 60 * 1000);
    expect(locks.acquire('t', { userId: 'u2', operation: 'migrate' }).ok).toBe(false);
    c.advance(2 * 60 * 1000);
    expect(locks.acquire('t', { userId: 'u2', operation: 'migrate' }).ok).toBe(true);
  });

  it('reports what is running, for the activity toast', () => {
    const locks = new TargetLocks();
    locks.acquire('a', { userId: 'u1', operation: 'migrate' });
    locks.acquire('b', { userId: 'u2', operation: 'index-maintenance' });
    const active = locks.active();
    expect(active).toHaveLength(2);
    expect(active.map((a) => a.operation).sort()).toEqual(['index-maintenance', 'migrate']);
  });

  it('does not report an expired lock as active', () => {
    const c = clock();
    const locks = new TargetLocks(c.now);
    locks.acquire('t', { userId: 'u1', operation: 'migrate' });
    c.advance(31 * 60 * 1000);
    expect(locks.active()).toEqual([]);
  });
});

describe('describeAge', () => {
  // The message this feeds is the only thing a blocked user sees, and the old
  // version floored at one minute — so a lock a second old read as "started
  // 1 minute ago", which invites someone to assume it is stuck.
  it.each([
    [0, '0 seconds'],
    [1_000, '1 second'],
    [2_400, '2 seconds'],
    [59_000, '59 seconds'],
    [60_000, '1 minute'],
    [150_000, '3 minutes'],
  ])('describes %ims as %s', (ms, expected) => {
    expect(describeAge(ms)).toBe(expected);
  });
});
