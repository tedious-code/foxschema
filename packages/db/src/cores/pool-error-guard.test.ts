import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { guardClientErrors, guardPoolErrors } from './pool-error-guard.js';

/**
 * An unhandled 'error' event on a driver pool kills the process.
 *
 * Every pooling driver reports an *idle* connection failing by emitting
 * 'error' on the pool rather than rejecting a query — a database restart, a
 * failover, a container stopping, `57P01 terminating connection due to
 * administrator command`. Node treats an unhandled 'error' event as a throw,
 * so one idle connection took the whole API down and every later request 502'd
 * with nothing to explain it.
 *
 * This was fixed for the pg pools first; mysql2 and mssql pools are
 * EventEmitters with the same exposure, which is why the guard is shared.
 */
describe('guardPoolErrors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('makes an idle-connection error survivable instead of fatal', () => {
    const pool = new EventEmitter();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    guardPoolErrors(pool, 'postgres');

    const err = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
    });
    // Without a listener this throws — that is the entire bug.
    expect(() => pool.emit('error', err)).not.toThrow();
  });

  it('an unguarded pool really does throw, so the guard is doing the work', () => {
    // Guards the test itself: if EventEmitter stopped behaving this way the
    // case above would pass for the wrong reason.
    const bare = new EventEmitter();
    expect(() => bare.emit('error', new Error('boom'))).toThrow(/boom/);
  });

  it('reports the failure rather than swallowing it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = new EventEmitter();
    guardPoolErrors(pool, 'sqlserver');
    pool.emit('error', new Error('socket hang up'));

    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('sqlserver');
    expect(logged).toContain('socket hang up');
  });

  it('survives an error with no message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = new EventEmitter();
    guardPoolErrors(pool, 'mysql');
    expect(() => pool.emit('error', undefined)).not.toThrow();
  });

  it('leaves non-EventEmitter pools alone', () => {
    // oracledb, ibm_db and the ClickHouse HTTP client have no event to listen
    // for; attaching blindly would throw at acquire time.
    const notAnEmitter = { close: () => undefined };
    expect(() => guardPoolErrors(notAnEmitter, 'oracle')).not.toThrow();
    expect(guardPoolErrors(notAnEmitter, 'oracle')).toBe(notAnEmitter);
  });

  it('returns the pool so it can wrap a factory inline', () => {
    const pool = new EventEmitter();
    expect(guardPoolErrors(pool, 'redshift')).toBe(pool);
  });
});

/**
 * The pool guard covers connections sitting idle. A client the caller is
 * holding emits `'error'` on itself, and nothing was listening there — a
 * Postgres restart mid-run killed the API process outright.
 */
describe('guardClientErrors', () => {
  it('makes a checked-out client dropping survivable instead of fatal', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = guardClientErrors(new EventEmitter(), 'postgres');
    expect(() =>
      client.emit('error', new Error('Connection terminated unexpectedly'))
    ).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('an unguarded client really does throw, so the guard is doing the work', () => {
    const bare = new EventEmitter();
    expect(() => bare.emit('error', new Error('Connection terminated unexpectedly'))).toThrow(
      /Connection terminated/
    );
  });

  it('attaches once however often the same client is checked out', () => {
    // A pooled client is handed out and released many times over. Adding a
    // listener per acquire would be our own leak, and Node would warn about it.
    const client = new EventEmitter();
    for (let i = 0; i < 20; i++) guardClientErrors(client, 'postgres');
    expect(client.listenerCount('error')).toBe(1);
  });

  it('leaves non-EventEmitter and missing clients alone', () => {
    const plain = { release: () => undefined };
    expect(guardClientErrors(plain, 'duckdb')).toBe(plain);
    expect(guardClientErrors(null, 'duckdb')).toBeNull();
  });
});
