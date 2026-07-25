import { describe, expect, it } from 'vitest';
import {
  executeCodeCellSync,
  normalizeCodeCellReturn,
  sanitizeVarsForCodeCell,
  codeCellHasReturn,
} from './codeCellExec';
import { prepareCodeCellSource } from './codeCellRunner';

describe('sanitizeVarsForCodeCell', () => {
  it('omits secret variables', () => {
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
    expect(vars.token).toBeUndefined();
    expect(vars.n).toEqual({ kind: 'scalar', value: 3 });
    expect(vars.ids).toEqual({ kind: 'list', values: [1, 2] });
    expect(vars.t).toEqual({ kind: 'table', columns: ['a'], rows: [[1]] });
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

  it('rejects unsupported returns', () => {
    expect(normalizeCodeCellReturn(42, 10).ok).toBe(false);
  });
});

describe('executeCodeCellSync', () => {
  it('maps last.rows into a new grid', () => {
    const r = executeCodeCellSync({
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

  it('allows local variables and for…of loops', () => {
    const r = executeCodeCellSync({
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

  it('rejects cells without a return statement', () => {
    const r = executeCodeCellSync({
      body: `const rows = last.rows.map((r) => ({ id: r[0] }));`,
      last: { columns: ['id'], rows: [[1]], rowCount: 1 },
      vars: {},
      maxRows: 10,
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/return statement/i);
  });

  it('ignores the word return inside strings when checking', () => {
    expect(codeCellHasReturn(`const s = "return nothing";`)).toBe(false);
    expect(codeCellHasReturn(`const s = "return nothing";\nreturn [];`)).toBe(true);
  });

  it('reads vars and surfaces throws', () => {
    const ok = executeCodeCellSync({
      body: `return { columns: ['v'], rows: [[vars.n.value]] };`,
      last: null,
      vars: { n: { kind: 'scalar', value: 9 } },
      maxRows: 10,
    });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.rows).toEqual([[9]]);

    const bad = executeCodeCellSync({
      body: `throw new Error('boom'); return null;`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.error).toMatch(/boom/);
  });
});


describe('prepareCodeCellSource', () => {
  it('strips fence markers and @set lines', () => {
    const prepared = prepareCodeCellSource(`-- @js
-- @set out = table
return last;
-- @end`);
    expect(prepared).toMatchObject({
      kind: 'js',
      body: 'return last;',
    });
    if (!('error' in prepared)) {
      expect(prepared.directives).toEqual([{ mode: 'table', name: 'out' }]);
    }
  });

  it('accepts leading @set above the fence', () => {
    const prepared = prepareCodeCellSource(`-- @set src = table
-- @js
return last;
-- @end`);
    expect(prepared).toMatchObject({ kind: 'js', body: 'return last;' });
    if (!('error' in prepared)) {
      expect(prepared.directives).toEqual([{ mode: 'table', name: 'src' }]);
    }
  });
});
