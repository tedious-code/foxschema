/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (apps/api/src/server.ts).
 */
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 8081);
const host = process.env.HOST ?? '127.0.0.1';
/** Hard cap on graceful shutdown; tsx watch SIGKILLs at 5s. */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.FOXFLOW_SHUTDOWN_TIMEOUT_MS ?? 3000);

const app = buildApp();

app
  .listen({ port, host })
  .then((address) => {
    console.log(`workflow-server listening on ${address}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * Graceful shutdown. Without this the process ignores SIGTERM (tsx's preflight
 * registers its own listener, which suppresses Node's default exit-on-signal),
 * so `tsx watch` restarts hung for 5s and then SIGKILLed — losing the onClose
 * hook that stops cron, drains runs, and closes SQLite.
 *
 * `app.close()` is still bounded: a wedged run or a stuck socket must not
 * outlive the timeout, so we force-exit rather than wait to be killed.
 */
let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  const forced = setTimeout(() => {
    console.error(`workflow-server: ${signal} shutdown timed out, exiting`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    console.error('workflow-server: shutdown failed', error);
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => void shutdown(signal));
}
