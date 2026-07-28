import { describe, expect, it } from 'vitest';
import { splitSqlStatements, checkStatement, parseCodeCell } from './sql-splitter';
import {
  SQL_EDITOR_SAMPLE_BOOKMARKS,
  buildSampleBookmarks,
} from './sqlEditorSamples';
import { prepareCodeCellSource, runCodeCell } from './codeCellRunner';
import { executeCodeCell } from './codeCellExec';

/** Normalize a raw cell result to the `{ ok }` shape the assertions use. */
function toStatementLike(r: Awaited<ReturnType<typeof executeCodeCell>>) {
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
}

describe('SQL Editor sample bookmarks', () => {
  it('exposes stable ids and non-empty SQL', () => {
    const ids = new Set(SQL_EDITOR_SAMPLE_BOOKMARKS.map((s) => s.id));
    expect(ids.size).toBe(SQL_EDITOR_SAMPLE_BOOKMARKS.length);
    for (const s of SQL_EDITOR_SAMPLE_BOOKMARKS) {
      expect(s.id).toMatch(/^sample-/);
      expect(s.title).toMatch(/★ Sample/);
      expect(s.sql.trim().length).toBeGreaterThan(20);
    }
  });

  it('buildSampleBookmarks preserves ids for install/merge', () => {
    const built = buildSampleBookmarks(123);
    expect(built.map((b) => b.id)).toEqual(
      SQL_EDITOR_SAMPLE_BOOKMARKS.map((s) => s.id)
    );
    expect(built.every((b) => b.updatedAt === 123)).toBe(true);
  });

  it('each sample splits cleanly and closed code cells check ok', () => {
    for (const sample of SQL_EDITOR_SAMPLE_BOOKMARKS) {
      const stmts = splitSqlStatements(sample.sql);
      expect(stmts.length, sample.id).toBeGreaterThan(0);
      const codeCells = stmts.filter((s) =>
        s.kind === 'js' || s.kind === 'ts' || s.kind === 'node' || s.kind === 'nodets'
      );
      expect(codeCells.length, sample.id).toBeGreaterThan(0);
      for (const cell of codeCells) {
        expect(cell.terminated, `${sample.id} missing @end`).toBe(true);
        const check = checkStatement(cell);
        expect(check.level, `${sample.id}: ${check.reasons.join('; ')}`).toBe('ok');
      }
    }
  });

  it('runs the JS-only sample end-to-end', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-js-pure-grid');
    expect(sample).toBeTruthy();
    const { result } = await runCodeCell({
      statement: sample!.sql,
      last: null,
      variables: [],
      maxRows: 100,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ ok: true, rowCount: 1 });
    expect(result.rows).toEqual([[2, 1]]);
  });

  it('runs the lodash aggregate sample against a synthetic prior grid', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-js-lodash-aggregate');
    expect(sample).toBeTruthy();
    const stmts = splitSqlStatements(sample!.sql);
    const js = stmts.find((s) => s.kind === 'js');
    expect(js).toBeTruthy();
    const { result } = await runCodeCell({
      statement: js!.text,
      last: {
        columns: ['kind', 'n'],
        rows: [
          ['a', 10],
          ['a', 5],
          ['b', 7],
          ['b', 3],
        ],
        rowCount: 4,
      },
      variables: [],
      maxRows: 100,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([
      ['a', 2, 15],
      ['b', 2, 10],
    ]);
  });

  it('runs the explicit columns/rows sample against a synthetic prior grid', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-js-columns-rows');
    expect(sample).toBeTruthy();
    const stmts = splitSqlStatements(sample!.sql);
    const js = stmts.find((s) => s.kind === 'js');
    expect(js).toBeTruthy();
    const { result } = await runCodeCell({
      statement: js!.text,
      last: {
        columns: ['id', 'email'],
        rows: [[1, 'alice@example.com']],
        rowCount: 1,
      },
      variables: [],
      maxRows: 100,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.columns).toEqual(['id', 'email', 'upper']);
    expect(result.rows).toEqual([[1, 'alice@example.com', 'ALICE@EXAMPLE.COM']]);
  });

  it('runs map-last body against a synthetic prior grid', async () => {
    const sample = SQL_EDITOR_SAMPLE_BOOKMARKS.find((s) => s.id === 'sample-js-map-last');
    expect(sample).toBeTruthy();
    const stmts = splitSqlStatements(sample!.sql);
    const js = stmts.find((s) => s.kind === 'js');
    expect(js).toBeTruthy();
    const prepared = prepareCodeCellSource(js!.text);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const cell = parseCodeCell(js!.text);
    expect(cell?.kind).toBe('js');
    const r = await executeCodeCell({
      body: prepared.body,
      last: {
        columns: ['id', 'email'],
        rows: [
          [1, 'alice@example.com'],
          [2, 'bob@example.com'],
        ],
        rowCount: 2,
      },
      vars: {},
      maxRows: 100,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 2 });
    if (r.ok) {
      expect(r.rows).toEqual([
        [1, 'alice@example.com', 2],
        [2, 'bob@example.com', 4],
      ]);
    }
  });

  it('runs the chain sample second cell even with a SQL-style -- comment', async () => {
    const statement = `-- @js
-- Use last from the previous cell
return last.rows.map((r) => ({ id: r[0], domain: String(r[1]).split('@')[1] }));
-- @end
`;
    const prepared = prepareCodeCellSource(statement);
    expect(prepared).toMatchObject({
      ok: true,
      kind: 'js',
      body: "return last.rows.map((r) => ({ id: r[0], domain: String(r[1]).split('@')[1] }));",
    });

    const { result } = await runCodeCell({
      statement,
      last: {
        columns: ['id', 'email'],
        rows: [[1, 'alice@example.com']],
        rowCount: 1,
      },
      variables: [],
      maxRows: 100,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([[1, 'example.com']]);
  });

  /**
   * The statement strip lets you run a single cell, so `last` is null whenever
   * the cell runs without its companion SELECT. Every sample must degrade to an
   * empty grid rather than "Cannot read properties of null (reading 'rows')".
   */
  it('every browser sample survives running standalone (last = null)', async () => {
    const cells = SQL_EDITOR_SAMPLE_BOOKMARKS.flatMap((sample) =>
      splitSqlStatements(sample.sql)
        .filter((st) => st.kind === 'js' || st.kind === 'ts')
        .map((st) => ({ id: sample.id, text: st.text }))
    ).filter((c) => !/\bfetch\s*\(/.test(c.text)); // skip network samples

    expect(cells.length).toBeGreaterThan(5);

    for (const cell of cells) {
      const prepared = prepareCodeCellSource(cell.text);
      expect(prepared.ok, cell.id).toBe(true);
      if (!prepared.ok) continue;
      const body =
        prepared.kind === 'ts'
          ? (await runCodeCell({ statement: cell.text, last: null, variables: [], maxRows: 50 }))
          : null;
      const result = body
        ? body.result
        : toStatementLike(
            await executeCodeCell({ body: prepared.body, last: null, vars: {}, maxRows: 50 })
          );
      if (!result.ok) {
        throw new Error(`${cell.id} failed with last=null: ${result.error}`);
      }
    }
  }, 20_000);
});
