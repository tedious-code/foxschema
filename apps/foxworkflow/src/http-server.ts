/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal node:http FoxWorkflow engine.
 */
import http from 'node:http';
import type { AdminConfigPut } from '@foxschema/workflow-contract';
import { EngineStore } from './engine-store';
import { writeSinkLines } from './log-sinks';

const VERSION = '0.1.0-scaffold';

export function createFoxworkflowServer(store = new EngineStore()): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const method = (req.method ?? 'GET').toUpperCase();

    const json = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    try {
      if (method === 'GET' && url.pathname === '/health') {
        json(200, store.getHealth(VERSION));
        return;
      }
      if (method === 'GET' && url.pathname === '/v1/config') {
        json(200, store.getConfig());
        return;
      }
      if (method === 'PUT' && url.pathname === '/v1/admin/config') {
        const raw = await readBody(req);
        let body: AdminConfigPut = {};
        if (raw.trim()) {
          body = JSON.parse(raw) as AdminConfigPut;
        }
        const next = store.applyAdminPut(body);
        writeSinkLines(next.sinks, 'admin.config.updated', {
          acceptsRuns: next.state === 'enabled',
          sinkCount: next.sinks.filter((s) => s.enabled).length,
        });
        json(200, next);
        return;
      }
      if (method === 'GET' && url.pathname === '/v1/runs') {
        json(200, { runs: [] });
        return;
      }
      json(404, { ok: false, error: 'not found' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'request failed';
      json(400, { ok: false, error: message });
    }
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function listen(
  port = Number(process.env.FOXWORKFLOW_PORT) || 8081,
  host = process.env.LISTEN_HOST ?? '127.0.0.1',
  store = new EngineStore(),
): Promise<http.Server> {
  const server = createFoxworkflowServer(store);
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on('error', reject);
  });
  return server;
}
