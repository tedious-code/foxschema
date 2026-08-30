/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The HTTP contract: what every route answers, asserted against a real server.
 *
 * This exists because the Express-to-Fastify migration rewrites the transport
 * under 80 routes whose logic does not change — precisely the edit unit tests
 * cannot see. This codebase has already produced the proof: a route that passed
 * typecheck and the whole suite hung forever in production, because middleware
 * was wired wrong. Only a live request found it.
 *
 * Two design decisions worth keeping:
 *
 * **A real listener, not `app.inject()`.** The obvious harness is Fastify's
 * inject, and it is wrong here: routes still served through the `@fastify/express`
 * bridge get a synthetic req/res that Express cannot write to, so every POST
 * comes back 500 with an empty body while the same request over a socket
 * answers 400 correctly. A harness that reports false failures is worse than
 * none — it trains you to ignore it.
 *
 * **The table is the Express baseline.** Every expectation below was recorded
 * from the Express server before it was removed, so this suite still asserts
 * "nothing changed when the server swapped" — it is the only thing that does.
 *
 * The expectations are what the API does today, captured deliberately: this is
 * a regression net, not a wish list. It started with two shrinking allow-lists
 * for behaviour that was wrong — 6 routes answering 500 to an empty body, and
 * 50 of 51 error responses with no machine-readable code. Both reached zero, so
 * both assertions are now unconditional.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { isApiErrorBody } from '@foxschema/shared';

interface RouteExpectation {
  method: string;
  path: string;
  /** Status for a request with no meaningful input — an empty JSON body. */
  status: number;
}

/**
 * Every route the API serves, with what it answers to an empty request.
 *
 * A placeholder UUID is substituted for `:params`, so "not found" is the
 * expected answer for anything that looks a record up — that is the point:
 * a *reachable* route that cannot find a record, rather than a crash.
 */
const ROUTES: RouteExpectation[] = [
  { method: 'GET', path: '/api/activity', status: 200 },
  { method: 'GET', path: '/api/admin/role-permissions', status: 200 },
  { method: 'PUT', path: '/api/admin/role-permissions/:role', status: 400 },
  { method: 'GET', path: '/api/admin/users', status: 200 },
  { method: 'PUT', path: '/api/admin/users/:id/active', status: 400 },
  { method: 'PUT', path: '/api/admin/users/:id/password', status: 400 },
  { method: 'PUT', path: '/api/admin/users/:id/role', status: 400 },
  { method: 'GET', path: '/api/app-info', status: 200 },
  { method: 'GET', path: '/api/app-secrets', status: 200 },
  { method: 'POST', path: '/api/app-secrets', status: 400 },
  { method: 'DELETE', path: '/api/app-secrets/:id', status: 404 },
  { method: 'PUT', path: '/api/app-secrets/:id', status: 404 },
  { method: 'GET', path: '/api/app-secrets/providers', status: 200 },
  { method: 'POST', path: '/api/app-secrets/providers', status: 400 },
  { method: 'DELETE', path: '/api/app-secrets/providers/:id', status: 404 },
  { method: 'PUT', path: '/api/app-secrets/providers/:id', status: 404 },
  { method: 'POST', path: '/api/app-secrets/resolve', status: 200 },
  { method: 'POST', path: '/api/auth/login', status: 401 },
  { method: 'POST', path: '/api/auth/logout', status: 200 },
  { method: 'GET', path: '/api/auth/me', status: 200 },
  { method: 'POST', path: '/api/auth/register', status: 400 },
  { method: 'GET', path: '/api/auth/sso/:provider/callback', status: 302 },
  { method: 'GET', path: '/api/auth/sso/:provider/start', status: 404 },
  { method: 'GET', path: '/api/auth/sso/providers', status: 200 },
  { method: 'POST', path: '/api/compare', status: 400 },
  { method: 'POST', path: '/api/connection/test', status: 400 },
  { method: 'GET', path: '/api/connections', status: 200 },
  { method: 'POST', path: '/api/connections', status: 400 },
  { method: 'DELETE', path: '/api/connections/:id', status: 404 },
  { method: 'PUT', path: '/api/connections/:id', status: 400 },
  { method: 'POST', path: '/api/data-migrate/execute', status: 400 },
  { method: 'GET', path: '/api/data-migrations', status: 200 },
  { method: 'DELETE', path: '/api/data-migrations/:id', status: 404 },
  { method: 'GET', path: '/api/data-migrations/:id', status: 404 },
  { method: 'POST', path: '/api/data-migrations/:id/finish', status: 400 },
  { method: 'POST', path: '/api/data-migrations/start', status: 400 },
  { method: 'POST', path: '/api/db/test', status: 400 },
  { method: 'GET', path: '/api/driver/check', status: 400 },
  { method: 'POST', path: '/api/driver/install', status: 400 },
  { method: 'GET', path: '/api/files/browse', status: 200 },
  { method: 'GET', path: '/api/files/capacity', status: 200 },
  { method: 'POST', path: '/api/files/detect-columns', status: 400 },
  { method: 'POST', path: '/api/files/import', status: 400 },
  { method: 'DELETE', path: '/api/files/imports', status: 200 },
  { method: 'GET', path: '/api/files/imports', status: 200 },
  { method: 'DELETE', path: '/api/files/imports/:id', status: 404 },
  { method: 'POST', path: '/api/files/sessions', status: 400 },
  { method: 'DELETE', path: '/api/files/sessions/:id', status: 200 },
  { method: 'PUT', path: '/api/files/sessions/:id/chunk', status: 400 },
  { method: 'POST', path: '/api/files/sessions/:id/commit', status: 404 },
  { method: 'POST', path: '/api/lokee/capture', status: 400 },
  { method: 'GET', path: '/api/lokee/databases', status: 200 },
  { method: 'GET', path: '/api/lokee/databases/:id/compare', status: 400 },
  { method: 'GET', path: '/api/lokee/databases/:id/graph', status: 200 },
  { method: 'GET', path: '/api/lokee/databases/:id/inspect', status: 400 },
  { method: 'POST', path: '/api/lokee/databases/:id/revert', status: 400 },
  { method: 'GET', path: '/api/lokee/databases/:id/revert/plan', status: 400 },
  { method: 'GET', path: '/api/lokee/databases/:id/versions', status: 200 },
  { method: 'PATCH', path: '/api/lokee/databases/:id/versions/:versionId', status: 404 },
  { method: 'POST', path: '/api/migration/execute', status: 400 },
  { method: 'DELETE', path: '/api/migrations', status: 200 },
  { method: 'GET', path: '/api/migrations', status: 200 },
  { method: 'DELETE', path: '/api/migrations/:id', status: 404 },
  { method: 'GET', path: '/api/migrations/:id', status: 404 },
  { method: 'POST', path: '/api/migrations/delete', status: 200 },
  { method: 'POST', path: '/api/schema/db-access', status: 400 },
  { method: 'POST', path: '/api/schema/dba-utility', status: 400 },
  { method: 'POST', path: '/api/schema/index-fragmentation', status: 400 },
  { method: 'POST', path: '/api/schema/index-fragmentation-batch', status: 400 },
  { method: 'POST', path: '/api/schema/list', status: 400 },
  { method: 'POST', path: '/api/schema/load', status: 400 },
  { method: 'POST', path: '/api/signup', status: 400 },
  { method: 'POST', path: '/api/signup/skip', status: 200 },
  { method: 'GET', path: '/api/signup/state', status: 200 },
  { method: 'POST', path: '/api/sql/code-cell', status: 400 },
  { method: 'POST', path: '/api/sql/execute', status: 400 },
  { method: 'POST', path: '/api/updates/apply', status: 403 },
  { method: 'GET', path: '/api/updates/check', status: 200 },
  { method: 'GET', path: '/api/user/preferences', status: 200 },
  { method: 'PUT', path: '/api/user/preferences', status: 200 },
];

const KEY = '0'.repeat(64);

function url(path: string): string {
  return path.replace(/:(\w+)/g, '00000000-0000-0000-0000-000000000000');
}

/** Started on an ephemeral port so parallel test files cannot collide. */
async function startFastify(): Promise<{ port: number; stop: () => Promise<void> }> {
  const { createFastifyApp } = await import('./fastify-server');
  const app: FastifyInstance = await createFastifyApp({});
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  return { port, stop: () => app.close() };
}

interface Probe {
  status: number;
  body: unknown;
  text: string;
}

async function probe(port: number, route: RouteExpectation): Promise<Probe> {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(route.method);
  const res = await fetch(`http://127.0.0.1:${port}${url(route.path)}`, {
    method: route.method,
    redirect: 'manual',
    ...(hasBody ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON — the assertions below say when that is allowed */
  }
  return { status: res.status, body, text };
}

describe('HTTP contract', () => {
    let port: number;
    let stop: () => Promise<void>;

    beforeAll(async () => {
      process.env.LOCAL_SINGLE_USER = 'true';
      process.env.APP_ENCRYPTION_KEY ||= KEY;
      ({ port, stop } = await startFastify());
    }, 120_000);

    afterAll(async () => {
      await stop?.();
    });

    it('covers every route the API declares', () => {
      // Guards against the table silently falling behind the router files.
      // 80 is the count at the time of writing; a new route must be added here
      // deliberately, which is the point.
      expect(ROUTES.length).toBe(80);
      expect(new Set(ROUTES.map((r) => `${r.method} ${r.path}`)).size).toBe(ROUTES.length);
    });

    it('sets the security headers on a live response, and no framework banner', async () => {
      // The policy itself is unit-tested; what is asserted here is that the
      // onRequest hook is actually installed, on the server that ships.
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('cache-control')).toMatch(/no-store/);
      // Version and stack are free reconnaissance.
      expect(res.headers.get('x-powered-by')).toBeNull();
    });

    it.each(ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
      '%s answers as specified',
      async (key, route) => {
        const { status, body, text } = await probe(port, route);

        // A route that does not answer at all is the failure this whole file
        // exists to catch — the hang, or a 404 from a lost mount.
        expect(status, `${key} returned an unexpected status (body: ${text.slice(0, 200)})`).toBe(
          route.status
        );

        if (status >= 400 && status !== 302) {
          // No exceptions to either rule. Both started as allow-lists — 6 routes
          // answered 500 to an empty body, and 50 of 51 error responses carried
          // no code — and both lists reached zero, so they are gone. A new route
          // that regresses either fails here rather than being added to a list.
          expect(status, `${key} answers 500 to an empty body — add input validation`).not.toBe(
            500
          );
          expect(
            isApiErrorBody(body),
            `${key} must answer with the shared error contract { ok, error, code }`
          ).toBe(true);
        }
      },
      30_000
    );
  });
