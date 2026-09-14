/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scheduler role: cron and poll admission only. Runs it admits are queued for a
 * worker (or the server) to execute.
 */
import { createEngine, createTriggerCoordinators } from './context.js';

const engine = createEngine({
  executeInline: false,
  instanceId: process.env.FOXFLOW_INSTANCE_ID ?? 'scheduler',
});
const { cron, poll } = createTriggerCoordinators(engine);

await cron.recover();
cron.start();
poll.start();
console.log('workflow scheduler running (cron + poll admission, executeInline=false)');

process.on('SIGINT', () => {
  cron.stop();
  poll.stop();
  engine.close();
  process.exit(0);
});
