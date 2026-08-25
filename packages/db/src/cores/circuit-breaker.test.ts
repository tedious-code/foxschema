import { describe, it, expect, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  circuitKey,
  isAvailabilityFailure,
} from './circuit-breaker';

/** Controllable clock so cooldowns are exact rather than slept through. */
function at(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
  code: 'ECONNREFUSED',
});

describe('what counts as the target being down', () => {
  it.each([
    ['ECONNREFUSED', refused()],
    ['socket hang up', new Error('socket hang up')],
    ['a connect timeout', new Error('connection timed out')],
    ['Db2 communication error', new Error('SQL30081N A communication error has been detected')],
    ['Oracle unreachable', new Error('NJS-503: connection to host 127.0.0.1 could not be established')],
  ])('counts %s', (_label, err) => {
    expect(isAvailabilityFailure(err)).toBe(true);
  });

  it.each([
    ['a syntax error', new Error(`syntax error at or near "SELCT"`)],
    ['permission denied', new Error('permission denied for table orders')],
    ['a missing relation', new Error('relation "nope" does not exist')],
    ['a constraint violation', new Error('duplicate key value violates unique constraint')],
  ])('does NOT count %s', (_label, err) => {
    // A healthy server saying no must never trip the breaker — that would lock
    // a user out of a working database over their own typo.
    expect(isAvailabilityFailure(err)).toBe(false);
  });
});

describe('circuit breaker', () => {
  it('passes calls through while healthy', async () => {
    const cb = new CircuitBreaker();
    await expect(cb.run('pg', async () => 'ok')).resolves.toBe('ok');
    expect(cb.stateOf('pg')).toBe('closed');
  });

  it('opens after the threshold of consecutive availability failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow(/ECONNREFUSED/);
    }
    expect(cb.stateOf('pg')).toBe('open');
  });

  it('rejects without calling through once open — the entire point', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();

    const fn = vi.fn(async () => 'should not run');
    await expect(cb.run('pg', fn)).rejects.toBeInstanceOf(CircuitOpenError);
    // No socket opened, no timeout waited out.
    expect(fn).not.toHaveBeenCalled();
  });

  it('tells the caller how long to wait and what went wrong', async () => {
    const clock = at();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 15_000, now: clock.now });
    await expect(cb.run('pg://db', async () => { throw refused(); })).rejects.toThrow();
    const err = await cb.run('pg://db', async () => 'x').catch((e) => e);
    expect(err).toBeInstanceOf(CircuitOpenError);
    expect(err.retryAfterMs).toBe(15_000);
    expect(err.message).toMatch(/ECONNREFUSED/);
  });

  it('a healthy-but-rejecting call does not count, and clears prior failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    await expect(
      cb.run('pg', async () => { throw new Error('permission denied for table orders'); })
    ).rejects.toThrow(/permission denied/);
    // The server answered, so it is up — one more outage should not open it yet.
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    expect(cb.stateOf('pg')).toBe('closed');
  });

  it('admits exactly one trial call after the cooldown', async () => {
    const clock = at();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 10_000, now: clock.now });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    expect(cb.stateOf('pg')).toBe('open');

    clock.advance(9_999);
    expect(cb.stateOf('pg')).toBe('open');

    clock.advance(1);
    expect(cb.stateOf('pg')).toBe('half-open');
  });

  it('rejects concurrent probes while a half-open trial is in flight', async () => {
    // Docs promise one trial after cooldown. Without a trialInFlight gate,
    // every parallel caller (multi-destination Run, compare retries) would
    // open a socket again and re-create the connect-timeout pile-up.
    const clock = at();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 10_000, now: clock.now });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    clock.advance(10_000);
    expect(cb.stateOf('pg')).toBe('half-open');

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const trial = cb.run('pg', async () => {
      await gate;
      return 'back';
    });

    const fn = vi.fn(async () => 'should not run');
    const blocked = await Promise.allSettled([
      cb.run('pg', fn),
      cb.run('pg', fn),
      cb.run('pg', fn),
    ]);
    for (const result of blocked) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(CircuitOpenError);
    }
    expect(fn).not.toHaveBeenCalled();

    release();
    await expect(trial).resolves.toBe('back');
    expect(cb.stateOf('pg')).toBe('closed');
  });

  it('closes when the trial call succeeds', async () => {
    const clock = at();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 10_000, now: clock.now });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    clock.advance(10_000);
    await expect(cb.run('pg', async () => 'back')).resolves.toBe('back');
    expect(cb.stateOf('pg')).toBe('closed');
  });

  it('re-opens for a full cooldown when the trial call fails', async () => {
    // Otherwise a target that is still down would grant a trial on every call.
    const clock = at();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 10_000, now: clock.now });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    clock.advance(10_000);
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow(/ECONNREFUSED/);
    expect(cb.stateOf('pg')).toBe('open');

    clock.advance(9_999);
    expect(cb.stateOf('pg')).toBe('open');
  });

  it('requires the configured number of successes before closing', async () => {
    const clock = at();
    const cb = new CircuitBreaker({
      failureThreshold: 1, resetAfterMs: 1_000, successThreshold: 2, now: clock.now,
    });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    clock.advance(1_000);
    await cb.run('pg', async () => 'one');
    expect(cb.stateOf('pg')).toBe('half-open');
    await cb.run('pg', async () => 'two');
    expect(cb.stateOf('pg')).toBe('closed');
  });

  it('keeps targets independent — one dead server must not block a healthy one', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.run('dead', async () => { throw refused(); })).rejects.toThrow();
    expect(cb.stateOf('dead')).toBe('open');
    await expect(cb.run('alive', async () => 'ok')).resolves.toBe('ok');
    expect(cb.stateOf('alive')).toBe('closed');
  });

  it('reset re-admits a target immediately, for when the user fixes the connection', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.run('pg', async () => { throw refused(); })).rejects.toThrow();
    cb.reset('pg');
    await expect(cb.run('pg', async () => 'ok')).resolves.toBe('ok');
  });

  it('reports open targets for an operator view', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.run('pg://h/db', async () => { throw refused(); })).rejects.toThrow();
    const [snap] = cb.snapshot();
    expect(snap.state).toBe('open');
    expect(snap.lastError).toMatch(/ECONNREFUSED/);
    expect(snap.openUntil).toBeGreaterThan(0);
  });
});

describe('circuitKey', () => {
  it('identifies the server, not the credential', () => {
    // Two users of one server should share its health rather than each
    // discovering the outage separately.
    const a = circuitKey('postgres', { host: 'db', port: 5432, database: 'app' });
    const b = circuitKey('postgres', { host: 'db', port: 5432, database: 'app' });
    expect(a).toBe(b);
    expect(a).not.toContain('password');
  });

  it('separates different databases on the same host', () => {
    expect(circuitKey('postgres', { host: 'db', port: 5432, database: 'a' })).not.toBe(
      circuitKey('postgres', { host: 'db', port: 5432, database: 'b' })
    );
  });

  it('handles a file database with no host or port', () => {
    expect(circuitKey('sqlite', { database: '/tmp/a.db' })).toBe('sqlite://local//tmp/a.db');
  });
});
