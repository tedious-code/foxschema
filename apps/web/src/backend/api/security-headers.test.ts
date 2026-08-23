import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { securityHeaders } from './security-headers';

function run(path: string, opts = {}) {
  const headers: Record<string, string> = {};
  const removed: string[] = [];
  const res = {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    removeHeader: (k: string) => removed.push(k),
  } as unknown as Response;
  const next = vi.fn();
  securityHeaders(opts)({ path } as Request, res, next);
  return { headers, removed, called: next.mock.calls.length === 1 };
}

describe('security headers', () => {
  it('always calls through', () => {
    expect(run('/api/health').called).toBe(true);
  });

  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'no-referrer'],
  ])('sets %s on every response', (h, v) => {
    expect(run('/api/health').headers[h]).toBe(v);
    expect(run('/index.html').headers[h]).toBe(v);
  });

  it('forbids caching of API responses', () => {
    // These carry schema data and connection metadata; a shared cache holding
    // them would outlive the session that was allowed to see them.
    const { headers } = run('/api/connections');
    expect(headers['Cache-Control']).toMatch(/no-store/);
    expect(headers['Cache-Control']).toMatch(/private/);
  });

  it('leaves static assets cacheable', () => {
    // The SPA bundle is content-hashed; forbidding its cache would make every
    // page load re-download the app for no benefit.
    expect(run('/assets/app-abc123.js').headers['Cache-Control']).toBeUndefined();
  });

  it('sends a CSP for UI routes but not for API responses', () => {
    expect(run('/index.html').headers['Content-Security-Policy']).toBeTruthy();
    // A CSP on a JSON body does nothing; it would just be noise.
    expect(run('/api/health').headers['Content-Security-Policy']).toBeUndefined();
  });

  it('the CSP blocks framing, plugins and stray form posts', () => {
    const csp = run('/index.html').headers['Content-Security-Policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('the CSP still allows the dev HMR socket', () => {
    // Otherwise local development breaks in a way that invites turning the
    // whole header off.
    expect(run('/index.html').headers['Content-Security-Policy']).toMatch(/connect-src[^;]*ws:/);
  });

  it('omits HSTS by default', () => {
    // On plain-HTTP localhost this would pin a developer's browser to https
    // for a year — a self-inflicted outage that is awkward to undo.
    expect(run('/index.html').headers['Strict-Transport-Security']).toBeUndefined();
    expect(run('/index.html', { hsts: true }).headers['Strict-Transport-Security']).toMatch(/max-age=/);
  });

  it('drops the framework banner', () => {
    expect(run('/api/health').removed).toContain('X-Powered-By');
  });

  it('can be told it is not serving a UI', () => {
    expect(run('/index.html', { servesUi: false }).headers['Content-Security-Policy']).toBeUndefined();
  });
});
