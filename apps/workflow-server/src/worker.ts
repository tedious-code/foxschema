/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Worker role: recovers interrupted runs, then keeps executing queued ones.
 */
import { createEngine } from './context.js';
import { attachEngineSettings } from './engine-settings.js';

const engine = createEngine({ instanceId: process.env.FOXFLOW_INSTANCE_ID ?? 'worker' });
const detachSettings = attachEngineSettings(engine);

await engine.start();
console.log('workflow worker recovered queued/interrupted runs');

const pollMs = Number(process.env.FOXFLOW_WORKER_POLL_MS ?? 2000);
setInterval(() => {
  void engine.scheduler.dispatchAvailable().catch((error) => {
    console.error('worker dispatch failed', error);
  });
}, pollMs).unref?.();

process.on('SIGINT', () => {
  void detachSettings().finally(() => {
    engine.close();
    process.exit(0);
  });
});
