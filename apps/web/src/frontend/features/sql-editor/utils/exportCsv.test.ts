import { describe, expect, it } from 'vitest';
import { buildMultiGridCsv, toCsv } from '@/features/sql-editor/utils/exportCsv';

describe('exportCsv', () => {
  it('escapes quotes, commas, and newlines', () => {
    expect(toCsv(['a', 'b'], [['x', 'y']])).toBe('a,b\nx,y');
    expect(toCsv(['name'], [['say "hi"']])).toBe('name\n"say ""hi"""');
    expect(toCsv(['c'], [['a,b']])).toBe('c\n"a,b"');
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\n,');
  });

  it('builds side-by-side multi-grid CSV with prefixes and padding', () => {
    const built = buildMultiGridCsv(
      [
        { label: 'Source', columns: ['id', 'name'], rows: [[1, 'a'], [2, 'b']] },
        { label: 'Target', columns: ['id', 'name'], rows: [[1, 'a']] },
      ],
      {
        leadingColumns: ['op', 'key'],
        leadingRows: [
          ['edit', 'id=1'],
          ['add', 'id=2'],
        ],
      }
    );
    expect(built.columns).toEqual([
      'op',
      'key',
      'Source.id',
      'Source.name',
      'Target.id',
      'Target.name',
    ]);
    expect(built.rows).toEqual([
      ['edit', 'id=1', 1, 'a', 1, 'a'],
      ['add', 'id=2', 2, 'b', '', ''],
    ]);
    expect(toCsv(built.columns, built.rows)).toContain('Source.id,Source.name,Target.id,Target.name');
  });
});
