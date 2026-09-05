import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { postgresAdapter } from './postgres.adapter.js';
import { redshiftAdapter } from '../redshift/redshift.adapter.js';

/**
 * A pool with no 'error' listener kills the whole process.
 *
 * `pg` emits 'error' on the POOL (not on a query) when an *idle* client fails:
 * a server restart, a failover, or an administrator terminating the backend
 * (SQLSTATE 57P01). Node treats an unhandled 'error' event on an EventEmitter
 * as a throw, so a single reseeded database took the entire API process down —
 * observed as the UI going 502 mid-run with no message.
 *
 * postgres, cockroachdb and yugabytedb all share the pg adapter, and redshift
 * has its own copy, so both are covered here.
 */

/** Minimal stand-in for pg.Pool: an EventEmitter, which is what pg's is. */
class FakePool extends EventEmitter {
  connect = vi.fn(async () => ({ release: vi.fn() }));
  end = vi.fn(async () => undefined);
}

function stubDriver(adapter: unknown, pool: FakePool) {
  // `load()` resolves the real `pg` package; swap it for a factory we control.
  const a = adapter as { load: () => unknown; pools: { clear?: () => void } };
  // Must be constructible: the adapter calls `new pg.Pool(...)`.
  const PoolCtor = class {
    constructor() {
      return pool as unknown as object;
    }
  };
  return vi.spyOn(a, 'load').mockReturnValue({ Pool: PoolCtor });
}

describe.each([
  ['postgres', postgresAdapter],
  ['redshift', redshiftAdapter],
])('%s adapter pool error handling', (name, adapter) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches an error listener so an idle-client failure cannot crash the process', async () => {
    const pool = new FakePool();
    stubDriver(adapter, pool);

    // Unique connection string per test so the pool cache does not hand back
    // a pool created by an earlier case.
    const cs = `postgresql://u:p@localhost:5432/db_${name}_${Date.now()}`;
    await (adapter as never as {
      acquire: (cs: string, o: unknown, p: boolean) => Promise<unknown>;
    }).acquire(cs, {}, true);

    expect(pool.listenerCount('error')).toBeGreaterThan(0);
  });

  it('survives the exact 57P01 that killed the API', async () => {
    const pool = new FakePool();
    stubDriver(adapter, pool);
    const cs = `postgresql://u:p@localhost:5432/db_${name}_57p01_${Date.now()}`;
    await (adapter as never as {
      acquire: (cs: string, o: unknown, p: boolean) => Promise<unknown>;
    }).acquire(cs, {}, true);

    const err = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
      severity: 'FATAL',
    });

    // Without a listener this line throws (that is the bug). It must not.
    expect(() => pool.emit('error', err)).not.toThrow();
  });

  it('reports the failure rather than swallowing it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = new FakePool();
    stubDriver(adapter, pool);
    const cs = `postgresql://u:p@localhost:5432/db_${name}_log_${Date.now()}`;
    await (adapter as never as {
      acquire: (cs: string, o: unknown, p: boolean) => Promise<unknown>;
    }).acquire(cs, {}, true);

    pool.emit('error', new Error('terminating connection due to administrator command'));

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('terminating connection due to administrator command');
  });
});
