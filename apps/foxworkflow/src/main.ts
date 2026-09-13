/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { listen } from './http-server';

const port = Number(process.env.FOXWORKFLOW_PORT) || 8081;

const server = await listen(port);
console.log(`foxworkflow listening on http://127.0.0.1:${port}`);

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
