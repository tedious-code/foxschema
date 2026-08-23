/**
 * Keep a driver pool's `'error'` event from killing the process.
 *
 * Every pooling driver here is an EventEmitter, and they all report failures on
 * *idle* connections by emitting `'error'` on the pool rather than rejecting a
 * query — a database restart, a failover, a container stopping, an admin
 * terminating the backend. Node treats an unhandled `'error'` event as a throw,
 * so one idle connection dying took the entire API process down with it, and
 * every subsequent request 502'd with nothing explaining why.
 *
 * There is nothing to do in response: the pool discards the dead connection and
 * reconnects on next use. The only job is to stay alive and say what happened.
 *
 * Guarded on `.on` being callable so this is safe for the non-EventEmitter
 * pools too (oracledb, ibm_db, the ClickHouse HTTP client), which simply have
 * no event to listen for.
 */
export function guardPoolErrors<T>(pool: T, label: string): T {
  const emitter = pool as unknown as {
    on?: (event: string, cb: (err: Error) => void) => unknown;
  };
  if (typeof emitter.on !== 'function') return pool;
  emitter.on('error', (err: Error) => {
    console.error(`[${label}] idle pool client error (recovering):`, err?.message ?? err);
  });
  return pool;
}
