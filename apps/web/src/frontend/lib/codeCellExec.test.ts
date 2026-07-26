import { describe, expect, it } from 'vitest';
import {
  executeCodeCell,
  normalizeCodeCellReturn,
  sanitizeVarsForCodeCell,
  codeCellHasReturn,
} from './codeCellExec';
import { prepareCodeCellSource } from './codeCellRunner';

describe('sanitizeVarsForCodeCell', () => {
  it('includes secret variables for API tokens in cells', () => {
    const vars = sanitizeVarsForCodeCell([
      { name: 'token', kind: 'scalar', value: 'secret', secret: true },
      { name: 'n', kind: 'scalar', value: 3 },
      { name: 'ids', kind: 'list', values: [1, 2] },
      {
        name: 't',
        kind: 'table',
        columns: ['a'],
        rows: [[1]],
      },
    ]);
    expect(vars.token).toEqual({ kind: 'scalar', value: 'secret' });
    expect(vars.n).toEqual({ kind: 'scalar', value: 3 });
    expect(vars.ids).toEqual({ kind: 'list', values: [1, 2] });
    expect(vars.t).toEqual({ kind: 'table', columns: ['a'], rows: [[1]] });
  });

  it('copies list and table values so cell mutations do not leak', () => {
    const values = [1, 2];
    const rows = [[9]];
    const vars = sanitizeVarsForCodeCell([
      { name: 'ids', kind: 'list', values },
      { name: 't', kind: 'table', columns: ['a'], rows },
    ]);
    (vars.ids as { values: unknown[] }).values.push(3);
    (vars.t as { rows: unknown[][] }).rows[0]!.push(0);
    expect(values).toEqual([1, 2]);
    expect(rows).toEqual([[9]]);
  });
});

describe('normalizeCodeCellReturn', () => {
  it('accepts columns/rows and caps maxRows', () => {
    const r = normalizeCodeCellReturn(
      { columns: ['a'], rows: [[1], [2], [3]] },
      2
    );
    expect(r).toMatchObject({ ok: true, rowCount: 2, truncated: true });
    if (r.ok) expect(r.rows).toEqual([[1], [2]]);
  });

  it('accepts array of objects', () => {
    const r = normalizeCodeCellReturn([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], 50);
    expect(r).toMatchObject({ ok: true, columns: ['id', 'name'], rowCount: 2 });
    if (r.ok) expect(r.rows).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('accepts empty array as empty grid', () => {
    expect(normalizeCodeCellReturn([], 10)).toEqual({
      ok: true,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    });
  });

  it('maps object rows under declared columns', () => {
    const r = normalizeCodeCellReturn(
      {
        columns: ['id', 'name'],
        rows: [{ id: 1, name: 'a', extra: 'x' }, { id: 2 }],
      },
      50
    );
    expect(r).toMatchObject({ ok: true, columns: ['id', 'name'], rowCount: 2 });
    if (r.ok) expect(r.rows).toEqual([
      [1, 'a'],
      [2, undefined],
    ]);
  });

  it('unions keys across object rows', () => {
    const r = normalizeCodeCellReturn([{ a: 1 }, { b: 2 }], 10);
    expect(r).toMatchObject({ ok: true, columns: ['a', 'b'] });
    if (r.ok) expect(r.rows).toEqual([
      [1, undefined],
      [undefined, 2],
    ]);
  });

  it('rejects null, primitives, and arrays of non-objects', () => {
    expect(normalizeCodeCellReturn(null, 10).ok).toBe(false);
    expect(normalizeCodeCellReturn(undefined, 10).ok).toBe(false);
    expect(normalizeCodeCellReturn(42, 10).ok).toBe(false);
    expect(normalizeCodeCellReturn([1, 2, 3], 10).ok).toBe(false);
    expect(normalizeCodeCellReturn({ columns: ['a'] }, 10).ok).toBe(false);
  });
});

describe('codeCellHasReturn', () => {
  it('ignores return inside strings, line comments, and block comments', () => {
    expect(codeCellHasReturn(`const s = "return nothing";`)).toBe(false);
    expect(codeCellHasReturn(`const s = 'return nothing';`)).toBe(false);
    expect(codeCellHasReturn('const s = `return nothing`;')).toBe(false);
    expect(codeCellHasReturn(`// return nowhere\nconst x = 1;`)).toBe(false);
    expect(codeCellHasReturn(`/* return nowhere */\nconst x = 1;`)).toBe(false);
    expect(codeCellHasReturn(`const s = "return nothing";\nreturn [];`)).toBe(true);
    expect(codeCellHasReturn(`// return nowhere\nreturn [];`)).toBe(true);
  });
});

describe('executeCodeCell', () => {
  it('maps last.rows into a new grid', async () => {
    const r = await executeCodeCell({
      body: `return {
        columns: ['id', 'n'],
        rows: last.rows.map((r) => [r[0], Number(r[0]) * 2]),
      };`,
      last: { columns: ['id'], rows: [[1], [2]], rowCount: 2 },
      vars: {},
      maxRows: 100,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 2 });
    if (r.ok) expect(r.rows).toEqual([
      [1, 2],
      [2, 4],
    ]);
  });

  it('allows local variables and for…of loops', async () => {
    const r = await executeCodeCell({
      body: `
        const out = [];
        const factor = 2;
        for (const row of last.rows) {
          const id = Number(row[0]);
          out.push({ id, n: id * factor });
        }
        return out;
      `,
      last: { columns: ['id'], rows: [[3], [5]], rowCount: 2 },
      vars: {},
      maxRows: 100,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 2, columns: ['id', 'n'] });
    if (r.ok) expect(r.rows).toEqual([
      [3, 6],
      [5, 10],
    ]);
  });

  it('supports while loops, if branches, and nested helpers', async () => {
    const r = await executeCodeCell({
      body: `
        function label(n) {
          if (n % 2 === 0) return 'even';
          return 'odd';
        }
        const out = [];
        let i = 0;
        while (i < last.rows.length) {
          const id = Number(last.rows[i][0]);
          out.push({ id, kind: label(id) });
          i++;
        }
        return out;
      `,
      last: { columns: ['id'], rows: [[1], [2], [3]], rowCount: 3 },
      vars: {},
      maxRows: 100,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 3 });
    if (r.ok) {
      expect(r.columns).toEqual(['id', 'kind']);
      expect(r.rows).toEqual([
        [1, 'odd'],
        [2, 'even'],
        [3, 'odd'],
      ]);
    }
  });

  it('passes through last as columns/rows', async () => {
    const last = { columns: ['id'], rows: [[7]], rowCount: 1 };
    const r = await executeCodeCell({
      body: 'return last;',
      last,
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true, columns: ['id'], rowCount: 1 });
    if (r.ok) expect(r.rows).toEqual([[7]]);
  });

  it('handles null last by guarding in cell code', async () => {
    const r = await executeCodeCell({
      body: `return last ? last.rows.map((r) => ({ id: r[0] })) : [];`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 0 });
  });

  it('reads scalar, list, and table vars', async () => {
    const r = await executeCodeCell({
      body: `return {
        columns: ['n', 'first', 'cell'],
        rows: [[vars.n.value, vars.ids.values[0], vars.t.rows[0][0]]],
      };`,
      last: null,
      vars: {
        n: { kind: 'scalar', value: 9 },
        ids: { kind: 'list', values: [11, 22] },
        t: { kind: 'table', columns: ['a'], rows: [['x']] },
      },
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.rows).toEqual([[9, 11, 'x']]);
  });

  it('rejects cells without a return statement', async () => {
    const r = await executeCodeCell({
      body: `const rows = last.rows.map((r) => ({ id: r[0] }));`,
      last: { columns: ['id'], rows: [[1]], rowCount: 1 },
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/return statement/i);
  });

  it('rejects empty body and empty-after-imports', async () => {
    expect(await executeCodeCell({
      body: '   ',
      last: null,
      vars: {},
      maxRows: 10,
    })).toMatchObject({ ok: false, error: expect.stringMatching(/empty/i) });

    expect(await executeCodeCell({
      body: `import _ from 'lodash';\n`,
      last: null,
      vars: {},
      maxRows: 10,
    })).toMatchObject({ ok: false, error: expect.stringMatching(/empty after imports/i) });
  });

  it('resolves returned Promises', async () => {
    const r = await executeCodeCell({
      body: `return Promise.resolve([{ id: 1 }]);`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 1 });
    if (r.ok) expect(r.rows).toEqual([[1]]);
  });

  it('surfaces thrown errors and syntax errors', async () => {
    const thrown = await executeCodeCell({
      body: `throw new Error('boom'); return null;`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(thrown).toMatchObject({ ok: false });
    if (!thrown.ok) expect(thrown.error).toMatch(/boom/);

    const syntax = await executeCodeCell({
      body: `return {;`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(syntax.ok).toBe(false);
  });

  it('allows fetch and shadows window / document', async () => {
    const r = await executeCodeCell({
      body: `return [{
        fetchType: typeof fetch,
        windowType: typeof window,
        documentType: typeof document,
      }];`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.columns).toEqual(['fetchType', 'windowType', 'documentType']);
      expect(r.rows[0]?.[0]).toBe('function');
      expect(r.rows[0]?.[1]).toBe('undefined');
      expect(r.rows[0]?.[2]).toBe('undefined');
    }
  });

  it('awaits Promise returns and async/await', async () => {
    const r = await executeCodeCell({
      body: `
        const n = await Promise.resolve(7);
        return [{ n }];
      `,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.rows).toEqual([[7]]);
  });

  it('supports await fetch via mock', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, id: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const r = await executeCodeCell({
        body: `
          const res = await fetch('https://example.test/api');
          const json = await res.json();
          return [{ status: res.status, id: json.id }];
        `,
        last: null,
        vars: {},
        maxRows: 10,
      });
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect(r.rows).toEqual([[200, 42]]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('enforces maxRows truncation on object-array returns', async () => {
    const r = await executeCodeCell({
      body: `return last.rows.map((r) => ({ id: r[0] }));`,
      last: {
        columns: ['id'],
        rows: [[1], [2], [3], [4]],
        rowCount: 4,
      },
      vars: {},
      maxRows: 2,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 2, truncated: true });
    if (r.ok) expect(r.rows).toEqual([[1], [2]]);
  });
});

describe('prepareCodeCellSource', () => {
  it('strips fence markers and @set lines', () => {
    const prepared = prepareCodeCellSource(`-- @js
-- @set out = table
return last;
-- @end`);
    expect(prepared).toMatchObject({
      ok: true,
      kind: 'js',
      body: 'return last;',
    });
    if (prepared.ok) {
      expect(prepared.directives).toEqual([{ mode: 'table', name: 'out' }]);
    }
  });

  it('accepts leading @set above the fence', () => {
    const prepared = prepareCodeCellSource(`-- @set src = table
-- @js
return last;
-- @end`);
    expect(prepared).toMatchObject({ ok: true, kind: 'js', body: 'return last;' });
    if (prepared.ok) {
      expect(prepared.directives).toEqual([{ mode: 'table', name: 'src' }]);
    }
  });

  it('detects typescript fences and rejects plain SQL', () => {
    const ts = prepareCodeCellSource(`-- @ts
const n: number = 1;
return [{ n }];
-- @end`);
    expect(ts).toMatchObject({ ok: true, kind: 'ts', body: 'const n: number = 1;\nreturn [{ n }];' });

    expect(prepareCodeCellSource('SELECT 1;')).toEqual({ ok: false, error: 'Not a code cell' });
  });

  it('merges leading and inner @set directives', () => {
    const prepared = prepareCodeCellSource(`-- @set a = table
-- @js
-- @set b = table
return last;
-- @end`);
    expect(prepared).toMatchObject({ ok: true, kind: 'js', body: 'return last;' });
    if (prepared.ok) {
      expect(prepared.directives).toEqual([
        { mode: 'table', name: 'a' },
        { mode: 'table', name: 'b' },
      ]);
    }
  });
});

describe('code cell result and input isolation', () => {
  it('keeps columns that first appear after the sampling prefix', () => {
    const objs = Array.from({ length: 60 }, (_, i) =>
      i < 55 ? { id: i } : { id: i, note: 'late' }
    );
    const out = normalizeCodeCellReturn(objs, 200);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.columns).toEqual(['id', 'note']);
  });

  it('drops columns only past the row cap', () => {
    const objs = [{ id: 1 }, { id: 2, note: 'kept' }, { id: 3, late: 'cut' }];
    const out = normalizeCodeCellReturn(objs, 2);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.columns).toEqual(['id', 'note']);
      expect(out.truncated).toBe(true);
    }
  });

  it('does not let a cell mutate the previous grid', async () => {
    const prior = { columns: ['id'], rows: [[1], [2], [3]] as unknown[][], rowCount: 3 };
    const result = await executeCodeCell({
      body: 'last.rows.reverse(); last.rows.push([99]); return [{ n: last.rows.length }];',
      last: prior,
      vars: {},
      maxRows: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([[4]]);
    expect(prior.rows).toEqual([[1], [2], [3]]);
  });
});
