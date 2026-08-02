import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStaleUiServer, probeRunningVersion } from '../open.js';

describe('isStaleUiServer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats 404 on /api/files/imports as stale (pre-Query-files server)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/files/imports')) {
          return new Response('Not Found', { status: 404 });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    await expect(isStaleUiServer(3210, '0.2.10')).resolves.toBe(true);
  });

  it('treats 404 on POST /api/schema/dba-utility as stale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/files/imports')) {
          return new Response(JSON.stringify({ imports: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/api/schema/dba-utility')) {
          return new Response('<pre>Cannot POST /api/schema/dba-utility</pre>', { status: 404 });
        }
        return new Response(JSON.stringify({ ok: true, version: '0.2.4' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    await expect(isStaleUiServer(3210, '0.2.10')).resolves.toBe(true);
  });

  it('is not stale when capability routes exist and versions match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/files/imports')) {
          return new Response(JSON.stringify({ imports: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/api/schema/')) {
          // Route exists — validation error, not missing handler
          return new Response(JSON.stringify({ error: 'bad request' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, version: '0.2.10' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    await expect(isStaleUiServer(3210, '0.2.10')).resolves.toBe(false);
  });

  it('is stale when running version differs from installed CLI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/files/imports')) {
          return new Response(JSON.stringify({ imports: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/api/schema/')) {
          return new Response(JSON.stringify({ error: 'bad request' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, version: '0.2.4' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    await expect(isStaleUiServer(3210, '0.2.10')).resolves.toBe(true);
  });
});

describe('probeRunningVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads version from /api/health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, version: 'v0.2.10' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    await expect(probeRunningVersion(3210)).resolves.toBe('0.2.10');
  });
});
