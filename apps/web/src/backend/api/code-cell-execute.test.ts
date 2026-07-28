import { describe, expect, it } from 'vitest';
import { executeCodeCellNode } from './code-cell-node-exec';
import {
  clampCodeCellTimeout,
  runCodeCellOnServer,
  validateCodeCellRequest,
} from './code-cell-execute';

/** Value planted in APP_ENCRYPTION_KEY to prove an escaped cell cannot read it. */
const SENTINEL_SECRET = 'sentinel-must-not-leak';

describe('validateCodeCellRequest', () => {
  it('accepts a minimal js payload', () => {
    const v = validateCodeCellRequest({
      body: 'return [];',
      kind: 'js',
      last: null,
      vars: {},
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.kind).toBe('js');
      expect(v.value.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('rejects bad kind / empty body', () => {
    expect(validateCodeCellRequest({ body: '', kind: 'js' }).ok).toBe(false);
    expect(validateCodeCellRequest({ body: 'return [];', kind: 'python' }).ok).toBe(false);
  });

  it('rejects shallow or malformed last/vars', () => {
    expect(
      validateCodeCellRequest({
        body: 'return [];',
        kind: 'js',
        last: { columns: [1], rows: [[1]], rowCount: 1 },
      }).ok
    ).toBe(false);
    expect(
      validateCodeCellRequest({
        body: 'return [];',
        kind: 'js',
        last: null,
        vars: { n: { kind: 'list' } },
      }).ok
    ).toBe(false);
  });

  it('clamps timeout', () => {
    expect(clampCodeCellTimeout(50)).toBe(100);
    expect(clampCodeCellTimeout(999_999)).toBe(30_000);
  });
});

describe('executeCodeCellNode', () => {
  it('runs async + lodash', async () => {
    const r = await executeCodeCellNode({
      body: `import _ from 'lodash';
const n = await Promise.resolve(3);
return _.map([n], (x) => ({ x }));
`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 1 });
    if (r.ok) expect(r.rows).toEqual([[3]]);
  });

  it('supports await fetch via mock', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ hello: 'node' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const r = await executeCodeCellNode({
        body: `
          const res = await fetch('https://example.test');
          const json = await res.json();
          return [{ status: res.status, hello: json.hello }];
        `,
        last: null,
        vars: {},
        maxRows: 10,
      });
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect(r.rows).toEqual([[200, 'node']]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('runCodeCellOnServer (worker_threads sandbox)', () => {
  async function run(
    body: string,
    kind: 'js' | 'ts',
    timeoutMs = 5000
  ) {
    const validated = validateCodeCellRequest({
      body,
      kind,
      last: null,
      vars: {},
      maxRows: 10,
      timeoutMs,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.error);
    return runCodeCellOnServer(validated.value);
  }

  it('transpiles TS and returns a grid', async () => {
    // Worker cold-start (tsx) is slower under a full parallel vitest run.
    const result = await run(`const n: number = 2;\nreturn [{ n: n * 3 }];`, 'ts', 20_000);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([[6]]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('denies an escaped cell the server environment', async () => {
    const prev = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = SENTINEL_SECRET;
    try {
      // The AsyncFunction preamble shadows `process` lexically only — the Function
      // constructor compiles in global scope and reaches the real one. The worker
      // thread empties its own copy of process.env so the escape yields nothing.
      const result = await run(
        `const p = (function(){}).constructor('return process')();\n` +
          `return [{ envKeys: Object.keys(p.env).length, secret: String(p.env.APP_ENCRYPTION_KEY) }];`,
        'js',
        20_000
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.rows).toEqual([[0, 'undefined']]);
      // Parent env must stay intact (worker gets its own process.env copy).
      expect(process.env.APP_ENCRYPTION_KEY).toBe(SENTINEL_SECRET);
    } finally {
      if (prev === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = prev;
    }
  }, 30_000);

  it('kills a cell that never yields', async () => {
    const result = await run('while (true) {}\nreturn [];', 'js', 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timed out/i);
  }, 15_000);
});

describe('code cell SQL bridge', () => {
  /** Capture what the parent was asked to run, and reply with canned rows. */
  function stubRunner(rows: Record<string, unknown>[] = []) {
    const calls: { text: string; params: unknown[] }[] = [];
    const runQuery = async (text: string, params: unknown[]) => {
      calls.push({ text, params });
      return rows;
    };
    return { calls, runQuery };
  }

  async function runCell(
    body: string,
    opts: Parameters<typeof runCodeCellOnServer>[1],
    timeoutMs = 20_000
  ) {
    const v = validateCodeCellRequest({
      body,
      kind: 'js',
      last: null,
      vars: {},
      maxRows: 50,
      timeoutMs,
    });
    if (!v.ok) throw new Error(v.error);
    return runCodeCellOnServer(v.value, opts);
  }

  it('binds interpolations instead of inlining them', async () => {
    const { calls, runQuery } = stubRunner([{ who: "O'Brien" }]);
    const result = await runCell(
      'return await sql`SELECT * FROM t WHERE name = ${"O\'Brien"} AND id = ${7}`;',
      { dialect: 'postgres', allowWrites: false, runQuery }
    );
    if (!result.ok) throw new Error(result.error);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe('SELECT * FROM t WHERE name = $1 AND id = $2');
    expect(calls[0]!.params).toEqual(["O'Brien", 7]);
    expect(result.rows).toEqual([["O'Brien"]]);
  }, 30_000);

  it('builds a parameterized bulk INSERT from JS objects', async () => {
    const { calls, runQuery } = stubRunner();
    const result = await runCell(
      "const v=[{id:1,email:\"a'b\"},{id:2,email:'c'}];" +
        'await sql`INSERT INTO ${sql.id("accounts")} ${sql.values(v)}`;' +
        'return [{ done: true }];',
      { dialect: 'sqlite', allowWrites: true, runQuery }
    );
    if (!result.ok) throw new Error(result.error);
    expect(calls[0]!.text).toBe('INSERT INTO "accounts" ("id", "email") VALUES (?, ?), (?, ?)');
    expect(calls[0]!.params).toEqual([1, "a'b", 2, 'c']);
  }, 30_000);

  it('surfaces a query error to the cell as a catchable rejection', async () => {
    const runQuery = async () => {
      throw new Error('no such table: ghost');
    };
    const result = await runCell(
      'try { await sql`SELECT 1 FROM ghost`; return [{ caught: false }]; }' +
        ' catch (e) { return [{ caught: true, msg: String(e.message) }]; }',
      { dialect: 'sqlite', allowWrites: false, runQuery }
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]![0]).toBe(true);
    expect(String(result.rows[0]![1])).toContain('no such table: ghost');
  }, 30_000);

  it('reports a missing connection instead of hanging', async () => {
    const result = await runCell('return await sql`SELECT 1`;', { dialect: 'sqlite' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no connection/i);
  }, 30_000);

  it('does not count database time against the cell timeout', async () => {
    // 3 × 2s of query time (6s) under a 4s cell budget. If the clock ran during
    // bridged queries this would time out; the budget is still generous enough
    // to absorb worker cold-start when the whole suite runs in parallel.
    const runQuery = async () => {
      await new Promise((r) => setTimeout(r, 2000));
      return [{ n: 1 }];
    };
    const result = await runCell(
      'for (let i=0;i<3;i++) { await sql`SELECT 1`; } return [{ ok: true }];',
      { dialect: 'sqlite', allowWrites: false, runQuery },
      4000
    );
    expect(result.ok).toBe(true);
  }, 45_000);
});
