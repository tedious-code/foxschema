import { describe, expect, it } from 'vitest';
import {
  formatCodeCellBody,
  formatEditorSql,
  splitCodeFenceSlice,
} from './formatSql';

describe('splitCodeFenceSlice', () => {
  it('splits open / body / close', () => {
    const parts = splitCodeFenceSlice(`-- @js\nreturn 1;\n-- @end\n`, true);
    expect(parts.open).toBe('-- @js');
    expect(parts.body).toBe('return 1;');
    expect(parts.close).toBe('-- @end');
    expect(parts.trailingNl).toBe(true);
  });
});

describe('formatCodeCellBody', () => {
  it('pretty-prints javascript', async () => {
    const out = await formatCodeCellBody(
      `const x=1;return[{a:x,b:"hi"}]`,
      'js'
    );
    expect(out).toContain("const x = 1;");
    expect(out).toContain('return');
    expect(out).toMatch(/singleQuote|'/); // prettier singleQuote
    expect(out).toContain("'hi'");
  });

  it('pretty-prints typescript', async () => {
    const out = await formatCodeCellBody(
      `type Row={id:number};const rows:Row[]=[{id:1}];return rows;`,
      'ts'
    );
    expect(out).toContain('type Row');
    expect(out).toContain('number');
    expect(out.split('\n').length).toBeGreaterThan(1);
  });

  it('leaves invalid code unchanged', async () => {
    const bad = 'const x = {';
    expect(await formatCodeCellBody(bad, 'js')).toBe(bad);
  });
});

describe('formatEditorSql', () => {
  it('formats JS fences with prettier and keeps markers', async () => {
    const input = `SELECT 1;\n-- @js\nconst x=1;return[{n:x}];\n-- @end\n`;
    const out = await formatEditorSql(input, 'postgres');
    expect(out).toContain('-- @js');
    expect(out).toContain('-- @end');
    expect(out).toMatch(/const x = 1/);
    expect(out.toUpperCase()).toContain('SELECT');
  });

  it('formats lodash-es groupBy cells with readable wraps', async () => {
    const input = `-- @js
import {groupBy,sumBy} from 'lodash-es';
const rows=last.rows.map((r)=>({kind:String(r[0]),n:Number(r[1])}));
const byKind=groupBy(rows,'kind');
return Object.keys(byKind).map((kind)=>({kind,count:byKind[kind].length,total:sumBy(byKind[kind],'n')}));
-- @end
`;
    const out = await formatEditorSql(input, 'postgres');
    expect(out).toContain(`import { groupBy, sumBy } from 'lodash-es';`);
    expect(out).toContain('kind: String(r[0]),');
    expect(out).toContain("total: sumBy(byKind[kind], 'n'),");
    expect(out.trimEnd().endsWith('-- @end')).toBe(true);
  });
});
