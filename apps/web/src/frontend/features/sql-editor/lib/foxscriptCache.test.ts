import { describe, expect, it } from 'vitest';
import { parseFoxScript } from '@/shared/lib/sql-splitter';
import { codeBlockBodyRange } from '@/features/sql-editor/lib/foxscriptVirtualDocs';

describe('parseFoxScript web cache', () => {
  it('returns the same document object for identical source', () => {
    const source = `SELECT 1;

-- @js
return [{ n: 1 }];
-- @end
`;
    const a = parseFoxScript(source);
    const b = parseFoxScript(source);
    expect(a).toBe(b);
    expect(a.blocks).toHaveLength(2);
  });
});

describe('codeBlockBodyRange', () => {
  it('excludes the closing -- @end line', () => {
    const source = `-- @js
return 1;
-- @end
`;
    const doc = parseFoxScript(source);
    const block = doc.blocks[0];
    expect(block?.type).toBe('code');
    if (block?.type !== 'code') return;
    const { start, end } = codeBlockBodyRange(block);
    const body = source.slice(start, end);
    expect(body).toContain('return 1;');
    expect(body).not.toMatch(/@end/i);
  });

  it('preserves CRLF body spans for projection', () => {
    const source = "-- @js\r\nreturn 1;\r\n-- @end\r\n";
    const doc = parseFoxScript(source);
    const block = doc.blocks[0];
    expect(block?.type).toBe('code');
    if (block?.type !== 'code') return;
    const { start, end } = codeBlockBodyRange(block);
    expect(source.slice(start, end)).toBe('return 1;\r');
  });
});
