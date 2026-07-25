import { describe, expect, it } from 'vitest';
import { parseCodeCellImports } from './codeCellPackages';
import { executeCodeCellSync } from './codeCellExec';

describe('parseCodeCellImports', () => {
  it('accepts allowlisted default / named / namespace imports', () => {
    const parsed = parseCodeCellImports(`import _ from 'lodash';
import { format } from 'date-fns';
import * as df from 'date-fns';

return [];
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.specs).toHaveLength(3);
    expect(parsed.bodyWithoutImports).toBe('return [];');
  });

  it('rejects unknown packages', () => {
    const parsed = parseCodeCellImports(`import fs from 'fs';\nreturn [];`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/allowlisted/i);
  });

  it('rejects mid-body imports', () => {
    const parsed = parseCodeCellImports(`const x = 1;\nimport _ from 'lodash';\nreturn [];`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/top of the code cell/i);
  });
});

describe('executeCodeCellSync with imports + functions', () => {
  it('runs lodash + local function', () => {
    const body = `import _ from 'lodash';
function doubleRow(r) {
  return { id: r[0], n: Number(r[0]) * 2 };
}
return _.map(last.rows, doubleRow);
`;
    const r = executeCodeCellSync({
      body,
      last: { columns: ['id'], rows: [[4], [6]], rowCount: 2 },
      vars: {},
      maxRows: 100,
    });
    expect(r).toMatchObject({ ok: true, rowCount: 2 });
    if (r.ok) {
      expect(r.columns).toEqual(['id', 'n']);
      expect(r.rows).toEqual([
        [4, 8],
        [6, 12],
      ]);
    }
  });

  it('runs date-fns named import', () => {
    const r = executeCodeCellSync({
      body: `import { format } from 'date-fns';
return [{ stamp: format(new Date(Date.UTC(2020, 0, 2)), 'yyyy-MM-dd', { useAdditionalDayOfYearTokens: false }) }];
`,
      last: null,
      vars: {},
      maxRows: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.rows[0]?.[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
