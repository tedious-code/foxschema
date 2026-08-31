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

/**
 * Clients already carrying our listener, so a re-checkout does not stack more.
 *
 * A pooled client is handed out, released and handed out again, many times over
 * the life of the process. Attaching on every acquire would add a listener each
 * time and Node would eventually warn about a leak — while the real leak would
 * be ours.
 */
const guarded = new WeakSet<object>();

/**
 * Keep a *checked-out* client's `'error'` event from killing the process.
 *
 * {@link guardPoolErrors} covers connections sitting idle in the pool, which is
 * where most drops surface. It does not cover the client a caller is holding:
 * `pool.connect()` hands back a Client that emits `'error'` on its own when the
 * connection dies mid-use, and with no listener on *that* object Node throws.
 *
 * This is not hypothetical. A Postgres container restarting during a test run
 * killed the API process outright, and every request afterwards 502'd:
 *
 *     throw er; // Unhandled 'error' event
 *     Error: Connection terminated unexpectedly   (pg/lib/client.js)
 *     Emitted 'error' event on Client instance
 *
 * The in-flight query still rejects and the caller still sees its failure — the
 * only thing this changes is that the process survives to report it.
 */
export function guardClientErrors<T>(client: T, label: string): T {
  const emitter = client as unknown as {
    on?: (event: string, cb: (err: Error) => void) => unknown;
  };
  if (!client || typeof emitter.on !== 'function') return client;
  if (guarded.has(client as object)) return client;
  guarded.add(client as object);
  emitter.on('error', (err: Error) => {
    console.error(`[${label}] client error (connection dropped):`, err?.message ?? err);
  });
  return client;
}
