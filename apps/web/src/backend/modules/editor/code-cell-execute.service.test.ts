import { describe, expect, it } from 'vitest';
import { executeCodeCellNode } from './code-cell-node-exec.service';
import {
  clampCodeCellTimeout,
  codeCellWorkerEnv,
  runCodeCellOnServer,
  validateCodeCellRequest,
} from './code-cell-execute.service';
import { MAX_SQL } from '../../../shared/server-beam';

/** Value planted in APP_ENCRYPTION_KEY to prove an escaped cell cannot read it. */
const SENTINEL_SECRET = 'sentinel-must-not-leak';

describe('codeCellWorkerEnv', () => {
  it('keeps PATH but drops encryption / credential secrets', () => {
    const env = codeCellWorkerEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      APP_ENCRYPTION_KEY: SENTINEL_SECRET,
      DATABASE_URL: 'postgres://x',
      FOX_SECRET: 'nope',
      LANG: 'C',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    expect(env.LANG).toBe('C');
    expect(env.APP_ENCRYPTION_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.FOX_SECRET).toBeUndefined();
  });
});

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

  it('generates fake rows with faker', async () => {
    const r = await executeCodeCellNode({
      body: `import { faker } from '@faker-js/faker';
faker.seed(11);
return [{ name: faker.person.fullName(), sku: faker.string.alphanumeric(6) }];
`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 1 });
    if (r.ok) {
      expect(r.columns).toEqual(['name', 'sku']);
      expect(String(r.rows[0]![1])).toHaveLength(6);
    }
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
      // `.constructor` breakouts are rejected before the body runs — the cell
      // must fail closed rather than returning the secret (or even an empty env).
      const result = await run(
        `const p = (function(){}).constructor('return process')();\n` +
          `return [{ envKeys: Object.keys(p.env).length, secret: String(p.env.APP_ENCRYPTION_KEY) }];`,
        'js',
        20_000
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/constructor|sandbox|may not use/i);
      // Parent env must stay intact (worker gets its own scrubbed env copy).
      expect(process.env.APP_ENCRYPTION_KEY).toBe(SENTINEL_SECRET);
    } finally {
      if (prev === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = prev;
    }
  }, 30_000);

  it('denies constructor property / concat / Reflect escapes that recover import()', async () => {
    // These hide the call-form `.constructor(` that the original gate matched.
    // Static gate catches property/Reflect; runtime sealing catches concat.
    const attacks = [
      `const F = (async function () {}).constructor;\n` +
        `const fs = await F('return import("node:fs")')();\n` +
        `return [{ hasRead: typeof fs.readFileSync }];`,
      `const F = (async function () {})["constructor"];\n` +
        `const fs = await F('return import("node:fs")')();\n` +
        `return [{ hasRead: typeof fs.readFileSync }];`,
      `const k = "constru" + "ctor";\n` +
        `const F = (async function () {})[k];\n` +
        `const fs = await F('return import("node:fs")')();\n` +
        `return [{ hasRead: typeof fs.readFileSync }];`,
      `const F = Reflect.get(async function () {}, "constructor");\n` +
        `const fs = await F('return import("node:fs")')();\n` +
        `return [{ hasRead: typeof fs.readFileSync }];`,
      `const e = (0, eval);\nreturn [{ v: e("1+1") }];`,
    ];
    for (const body of attacks) {
      const result = await run(body, 'js', 20_000);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/may not use|constructor|eval|Reflect|sandbox|Function/i);
      }
    }
  }, 90_000);

  it('rejects dynamic import of Node builtins (fs / child_process / cwd)', async () => {
    const attacks = [
      `const fs = await import('node:fs');\nreturn [{ cwd: fs.realpathSync('.') }];`,
      `const cp = await import('node:child_process');\nreturn [{ who: cp.execSync('whoami').toString() }];`,
      `const os = await import('node:os');\nreturn [{ home: os.homedir() }];`,
      `const net = await import('node:net');\nreturn [{ ok: !!net }];`,
    ];
    for (const body of attacks) {
      const result = await run(body, 'js', 20_000);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/dynamic import\(\)|allowlisted/i);
    }
  }, 60_000);

  it('rejects eval / Function / require breakouts', async () => {
    const attacks = [
      `return [{ v: eval('1+1') }];`,
      `return [{ v: Function('return 1')() }];`,
      `return [{ v: require('fs') }];`,
    ];
    for (const body of attacks) {
      const result = await run(body, 'js', 20_000);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/may not use|allowlisted/i);
    }
  }, 45_000);

  it('still allows allowlisted static imports', async () => {
    const result = await run(
      `import _ from 'lodash';\nreturn _.map([1, 2], (n) => ({ n }));`,
      'js',
      20_000
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([[1], [2]]);
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

  it('routes sql.on(alias) to the matching Server Beam endpoint', async () => {
    const calls: { text: string; alias?: string }[] = [];
    const runQuery = async (text: string, _params: unknown[], alias?: string) => {
      calls.push({ text, alias });
      return [{ hop: alias ?? 'none' }];
    };
    const result = await runCell(
      `const a = await sql.on('source')\`SELECT \${1} AS n\`;` +
        `const b = await sql.on('target')\`SELECT \${2} AS n\`;` +
        `return [{ a: a[0].hop, b: b[0].hop }];`,
      {
        dialect: 'sqlite',
        allowWrites: false,
        runQuery,
        beamDialects: { source: 'sqlite', target: 'postgres' },
        defaultBeamAlias: 'source',
        enforceBeamSqlOnCap: true,
      }
    );
    if (!result.ok) throw new Error(result.error);
    expect(calls.map((c) => c.alias)).toEqual(['source', 'target']);
    expect(calls[0]!.text).toBe('SELECT ? AS n');
    expect(calls[1]!.text).toBe('SELECT $1 AS n');
    expect(result.rows).toEqual([['source', 'target']]);
  }, 30_000);

  it('rejects sql.on() calls beyond the Server Beam cap', async () => {
    const runQuery = async () => [{ n: 1 }];
    const body =
      'const out = [];\n' +
      `for (let i = 0; i < ${MAX_SQL + 1}; i++) {\n` +
      "  out.push(await sql.on('source')`SELECT ${'i'} AS n`);\n" +
      '}\n' +
      'return out;';
    const result = await runCell(body, {
      dialect: 'sqlite',
      allowWrites: false,
      runQuery,
      beamDialects: { source: 'sqlite' },
      defaultBeamAlias: 'source',
      enforceBeamSqlOnCap: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(new RegExp(`at most ${MAX_SQL} SQL bridge calls`, 'i'));
    }
  }, 60_000);

  it('counts plain sql`` toward the Beam cap (not only sql.on)', async () => {
    const calls: string[] = [];
    const runQuery = async (text: string) => {
      calls.push(text);
      return [{ n: 1 }];
    };
    // Mix: MAX_SQL - 1 via plain sql, then one sql.on succeeds, then one more fails.
    const body =
      `for (let i = 0; i < ${MAX_SQL - 1}; i++) { await sql\`SELECT 1\`; }\n` +
      `await sql.on('source')\`SELECT 2\`;\n` +
      `try { await sql\`SELECT 3\`; return [{ ok: true }]; }\n` +
      `catch (e) { return [{ ok: false, msg: String(e.message) }]; }`;
    const result = await runCell(body, {
      dialect: 'sqlite',
      allowWrites: false,
      runQuery,
      beamDialects: { source: 'sqlite' },
      defaultBeamAlias: 'source',
      enforceBeamSqlOnCap: true,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]![0]).toBe(false);
    expect(String(result.rows[0]![1])).toMatch(/at most .* SQL bridge calls/i);
    // Cap rejects before the last runQuery — MAX_SQL successful bridge calls.
    expect(calls.length).toBe(MAX_SQL);
  }, 60_000);

  it('enforces the Beam cap under Promise.all concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runQuery = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return [{ n: 1 }];
    };
    const body =
      `const jobs = [];\n` +
      `for (let i = 0; i < ${MAX_SQL + 5}; i++) {\n` +
      `  jobs.push(sql.on('source')\`SELECT \${i} AS n\`);\n` +
      `}\n` +
      `const settled = await Promise.allSettled(jobs);\n` +
      `const rejected = settled.filter((s) => s.status === 'rejected').length;\n` +
      `const fulfilled = settled.filter((s) => s.status === 'fulfilled').length;\n` +
      `return [{ fulfilled, rejected }];`;
    const result = await runCell(
      body,
      {
        dialect: 'sqlite',
        allowWrites: false,
        runQuery,
        beamDialects: { source: 'sqlite' },
        defaultBeamAlias: 'source',
        enforceBeamSqlOnCap: true,
      },
      60_000
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]![0]).toBe(MAX_SQL);
    expect(result.rows[0]![1]).toBe(5);
    // Serialized Beam bridge: at most one query in flight at a time.
    expect(maxInFlight).toBe(1);
  }, 90_000);

  it('allows exactly MAX_SQL sequential Beam bridge calls', async () => {
    const runQuery = async () => [{ n: 1 }];
    const body =
      `for (let i = 0; i < ${MAX_SQL}; i++) { await sql.on('source')\`SELECT 1\`; }\n` +
      `return [{ ok: true, n: ${MAX_SQL} }];`;
    const result = await runCell(body, {
      dialect: 'sqlite',
      allowWrites: false,
      runQuery,
      beamDialects: { source: 'sqlite' },
      defaultBeamAlias: 'source',
      enforceBeamSqlOnCap: true,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([[true, MAX_SQL]]);
  }, 60_000);

  it('does not enforce the Beam cap when the flag is off', async () => {
    const calls: number[] = [];
    const runQuery = async () => {
      calls.push(1);
      return [{ n: 1 }];
    };
    const body =
      `for (let i = 0; i < ${MAX_SQL + 3}; i++) { await sql.on('source')\`SELECT 1\`; }\n` +
      `return [{ n: ${MAX_SQL + 3} }];`;
    const result = await runCell(body, {
      dialect: 'sqlite',
      allowWrites: false,
      runQuery,
      beamDialects: { source: 'sqlite' },
      defaultBeamAlias: 'source',
      enforceBeamSqlOnCap: false,
    });
    if (!result.ok) throw new Error(result.error);
    expect(calls.length).toBe(MAX_SQL + 3);
    expect(result.rows).toEqual([[MAX_SQL + 3]]);
  }, 60_000);

  it('rejects an unknown sql.on alias with a clear error', async () => {
    const result = await runCell(
      `try { await sql.on('warehouse')\`SELECT 1\`; return [{ ok: true }]; }` +
        ` catch (e) { return [{ ok: false, msg: String(e.message) }]; }`,
      {
        dialect: 'sqlite',
        allowWrites: false,
        runQuery: async () => [{ n: 1 }],
        beamDialects: { source: 'sqlite', target: 'sqlite' },
        defaultBeamAlias: 'source',
        enforceBeamSqlOnCap: true,
      }
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]![0]).toBe(false);
    expect(String(result.rows[0]![1])).toMatch(/Unknown Server Beam alias "warehouse"/);
  }, 30_000);

  it('rejects inherited Object keys used as sql.on aliases', async () => {
    const result = await runCell(
      `try { await sql.on('toString')\`SELECT 1\`; return [{ ok: true }]; }` +
        ` catch (e) { return [{ ok: false, msg: String(e.message) }]; }`,
      {
        dialect: 'sqlite',
        allowWrites: false,
        runQuery: async () => [{ n: 1 }],
        beamDialects: { source: 'sqlite' },
        defaultBeamAlias: 'source',
        enforceBeamSqlOnCap: true,
      }
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]![0]).toBe(false);
    expect(String(result.rows[0]![1])).toMatch(/Unknown Server Beam alias "toString"/);
  }, 30_000);

  it('rejects sql.on when no Beam endpoints are configured', async () => {
    const result = await runCell(
      `try { await sql.on('source')\`SELECT 1\`; return [{ ok: true }]; }` +
        ` catch (e) { return [{ ok: false, msg: String(e.message) }]; }`,
      { dialect: 'sqlite', allowWrites: false, runQuery: async () => [{ n: 1 }] }
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]![0]).toBe(false);
    expect(String(result.rows[0]![1])).toMatch(/needs Server Beam endpoints/i);
  }, 30_000);

  it('routes plain sql`` to the default Beam alias', async () => {
    const calls: { alias?: string }[] = [];
    const runQuery = async (_text: string, _params: unknown[], alias?: string) => {
      calls.push({ alias });
      return [{ hop: alias ?? 'none' }];
    };
    const result = await runCell('return await sql`SELECT 1`;', {
      dialect: 'sqlite',
      allowWrites: false,
      runQuery,
      beamDialects: { source: 'sqlite', target: 'postgres' },
      defaultBeamAlias: 'source',
      enforceBeamSqlOnCap: true,
    });
    if (!result.ok) throw new Error(result.error);
    expect(calls).toEqual([{ alias: 'source' }]);
    expect(result.rows).toEqual([['source']]);
  }, 30_000);

  it('rejects an empty sql.on alias before posting a query', async () => {
    const result = await runCell(
      `try { sql.on('  '); return [{ ok: true }]; }` +
        ` catch (e) { return [{ ok: false, msg: String(e.message) }]; }`,
      {
        dialect: 'sqlite',
        allowWrites: false,
        runQuery: async () => [{ n: 1 }],
        beamDialects: { source: 'sqlite' },
        defaultBeamAlias: 'source',
        enforceBeamSqlOnCap: true,
      }
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]![0]).toBe(false);
    expect(String(result.rows[0]![1])).toMatch(/non-empty alias/i);
  }, 30_000);
});
