/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for route collection and guard inheritance.
 *
 * `flatten` decides which guards each route runs, so these cases matter for
 * every endpoint. A missing guard leaves an endpoint unprotected while its
 * responses still look correct, so it is checked here directly.
 */
import { describe, it, expect } from 'vitest';
import { Router, joinPath } from './router';
import type { Middleware, HttpRequest, HttpResponse, NextFunction } from './types';

/** A guard identifiable by name in assertions; it always continues. */
const guard = (name: string): Middleware => {
  const fn = (_req: HttpRequest, _res: HttpResponse, next: NextFunction) => next();
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
};

const noop = () => {};
const chainOf = (routes: ReturnType<Router['flatten']>, path: string) =>
  routes.find((r) => r.path === path)!.middlewares.map((m) => m.name);

describe('joinPath', () => {
  it.each([
    ['', '/health', '/health'],
    ['/api', '/health', '/api/health'],
    ['/api/', '/health', '/api/health'],
    ['/api', 'health', '/api/health'],
    ['/api', '/', '/api'],
    ['', '/', '/'],
  ])('joins %s + %s -> %s', (prefix, path, expected) => {
    expect(joinPath(prefix, path)).toBe(expected);
  });
});

describe('route collection', () => {
  it('records method, path and handler', () => {
    const r = Router();
    r.get('/things', noop);
    r.post('/things', noop);
    const routes = r.flatten();
    expect(routes.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /things', 'POST /things']);
  });

  it('prefixes routes from a mounted router', () => {
    const child = Router();
    child.get('/me', noop);
    const root = Router();
    root.use('/api/auth', child);
    expect(root.flatten()[0]!.path).toBe('/api/auth/me');
  });

  it('mounts without a prefix', () => {
    const child = Router();
    child.get('/compare', noop);
    const root = Router();
    root.use(child);
    expect(root.flatten()[0]!.path).toBe('/compare');
  });
});

describe('guard inheritance', () => {
  it('applies mount guards to every route beneath, outermost first', () => {
    const child = Router();
    child.get('/users', guard('perm'), noop);
    const root = Router();
    root.use('/api/admin', guard('auth'), child);
    expect(chainOf(root.flatten(), '/api/admin/users')).toEqual(['auth', 'perm']);
  });

  it('keeps a sibling mount clean', () => {
    // Guards must not leak between mounts: a guarded mount and an open one
    // registered side by side keep their own chains.
    const guarded = Router();
    guarded.get('/secret', noop);
    const open = Router();
    open.get('/health', noop);

    const root = Router();
    root.use('/api/admin', guard('auth'), guarded);
    root.use('/api', open);

    const routes = root.flatten();
    expect(chainOf(routes, '/api/admin/secret')).toEqual(['auth']);
    expect(chainOf(routes, '/api/health')).toEqual([]);
  });

  it('accumulates guards through nested mounts', () => {
    const leaf = Router();
    leaf.post('/execute', guard('permission'), noop);
    const mid = Router();
    mid.use(leaf);
    const root = Router();
    root.use('/api', guard('session'), guard('rateLimit'), mid);
    expect(chainOf(root.flatten(), '/api/execute')).toEqual([
      'session',
      'rateLimit',
      'permission',
    ]);
  });

  it('does not let a route guard escape to its siblings', () => {
    const r = Router();
    r.get('/a', guard('only-a'), noop);
    r.get('/b', noop);
    const routes = r.flatten();
    expect(chainOf(routes, '/a')).toEqual(['only-a']);
    expect(chainOf(routes, '/b')).toEqual([]);
  });
});

describe('unsupported shapes', () => {
  it('refuses a guard-only use()', () => {
    // The type signature rejects this at compile time. The runtime check covers
    // callers that reach it dynamically, and is asserted so it cannot be
    // removed unnoticed.
    const r = Router();
    const useAsAny = r.use as unknown as (m: Middleware) => void;
    expect(() => useAsAny(guard('stray'))).toThrow(/requires a router/);
  });
});
