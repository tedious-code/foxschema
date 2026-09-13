/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineStore } from './engine-store';
import { createFoxworkflowServer } from './http-server';
import { ensureLogsDir, logsDir } from './log-sinks';

describe('foxworkflow engine', () => {
  let server: ReturnType<typeof createFoxworkflowServer> | undefined;
  let baseUrl = '';

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  async function start(store = new EngineStore()) {
    server = createFoxworkflowServer(store);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${addr.port}`;
    return store;
  }

  it('updates acceptsRuns and sinks via PUT /v1/admin/config', async () => {
    const store = await start();
    ensureLogsDir();
    const res = await fetch(`${baseUrl}/v1/admin/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acceptsRuns: false,
        sinks: [
          { kind: 'json', enabled: true, target: 'test-engine.jsonl' },
          { kind: 'text', enabled: true, target: 'test-engine.log' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: string;
      sinks: { kind: string; enabled: boolean }[];
    };
    expect(body.state).toBe('disabled');
    expect(body.sinks.filter((s) => s.enabled).map((s) => s.kind).sort()).toEqual([
      'json',
      'text',
    ]);
    expect(store.getHealth().acceptsRuns).toBe(false);

    const jsonPath = `${logsDir()}/test-engine.jsonl`;
    const textPath = `${logsDir()}/test-engine.log`;
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(textPath)).toBe(true);
    expect(fs.readFileSync(jsonPath, 'utf8')).toContain('admin.config.updated');
    expect(fs.readFileSync(textPath, 'utf8')).toContain('admin.config.updated');
  });

  it('serves health and empty runs', async () => {
    await start();
    const health = await (await fetch(`${baseUrl}/health`)).json();
    expect(health).toMatchObject({ ok: true, acceptsRuns: true });
    const runs = await (await fetch(`${baseUrl}/v1/runs`)).json();
    expect(runs).toEqual({ runs: [] });
  });
});
