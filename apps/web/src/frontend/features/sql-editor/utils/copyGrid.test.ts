import { describe, expect, it } from 'vitest';
import { pickColumns, sliceGridRange, toTsv } from '@/features/sql-editor/utils/copyGrid';

describe('toTsv — shape', () => {
  it('omits the header row when columns are not requested', () => {
    expect(toTsv(null, [['a', 1]])).toBe('a\t1');
  });

  it('puts the header first when requested', () => {
    expect(toTsv(['name', 'qty'], [['a', 1]])).toBe('name\tqty\r\na\t1');
  });

  it('separates rows with CRLF', () => {
    // Excel on Windows mishandles a bare LF inside a quoted field.
    expect(toTsv(null, [['a'], ['b']])).toBe('a\r\nb');
  });

  it('copies an empty grid as an empty string, not a stray newline', () => {
    expect(toTsv(null, [])).toBe('');
    expect(toTsv([], [])).toBe('');
  });

  it('keeps a header-only copy usable', () => {
    expect(toTsv(['id', 'name'], [])).toBe('id\tname');
  });

  it('preserves column order as given', () => {
    // The caller maps the user's reordered columns; copy must match the screen.
    expect(toTsv(['b', 'a'], [[2, 1]])).toBe('b\ta\r\n2\t1');
  });
});

describe('toTsv — escaping keeps the paste aligned', () => {
  it('quotes a value containing a tab so it stays one cell', () => {
    // Unquoted, this would silently become two columns on paste.
    expect(toTsv(null, [['a\tb', 'c']])).toBe('"a\tb"\tc');
  });

  it('quotes a value containing a newline so it stays one row', () => {
    expect(toTsv(null, [['line1\nline2']])).toBe('"line1\nline2"');
    expect(toTsv(null, [['line1\r\nline2']])).toBe('"line1\r\nline2"');
  });

  it('doubles inner quotes and wraps', () => {
    expect(toTsv(null, [['say "hi"']])).toBe('"say ""hi"""');
  });

  it('leaves ordinary values unquoted', () => {
    // Commas are not special in TSV — quoting them would show literal quotes.
    expect(toTsv(null, [['plain, with comma', "O'Brien"]])).toBe(
      "plain, with comma\tO'Brien"
    );
  });

  it('escapes header names too', () => {
    expect(toTsv(['a\tb'], [])).toBe('"a\tb"');
  });
});

describe('pickColumns — choosing columns and their order', () => {
  const columns = ['id', 'name', 'city'];
  const rows = [
    [1, 'Alice', 'Denver'],
    [2, 'Bob', 'Austin'],
  ];

  it('passes the grid through untouched when nothing is chosen', () => {
    const out = pickColumns(columns, rows, null);
    expect(out.columns).toEqual(columns);
    expect(out.rows).toEqual(rows);
  });

  it('copies a subset', () => {
    const out = pickColumns(columns, rows, [0, 2]);
    expect(out.columns).toEqual(['id', 'city']);
    expect(out.rows).toEqual([
      [1, 'Denver'],
      [2, 'Austin'],
    ]);
  });

  it('honours the chosen order rather than the grid order', () => {
    // The whole point: the picker records click order, so a user can copy
    // name-then-id out of a grid that shows id-then-name.
    const out = pickColumns(columns, rows, [1, 0]);
    expect(out.columns).toEqual(['name', 'id']);
    expect(out.rows).toEqual([
      ['Alice', 1],
      ['Bob', 2],
    ]);
  });

  it('drops stale indices past the end of the result', () => {
    // A selection can outlive the result it was made against — re-running a
    // query with fewer columns must not inject empty cells.
    const out = pickColumns(columns, rows, [0, 9]);
    expect(out.columns).toEqual(['id']);
    expect(out.rows).toEqual([[1], [2]]);
  });

  it('ignores repeats so a column cannot be duplicated', () => {
    const out = pickColumns(columns, rows, [1, 1]);
    expect(out.columns).toEqual(['name']);
  });

  it('ignores negative and non-integer indices', () => {
    const out = pickColumns(columns, rows, [-1, 1.5, 2]);
    expect(out.columns).toEqual(['city']);
  });

  it('returns an empty grid when nothing valid is selected', () => {
    const out = pickColumns(columns, rows, []);
    expect(out.columns).toEqual([]);
    expect(out.rows).toEqual([[], []]);
  });

  it('does not alias the caller rows', () => {
    // The copy path must never hand back references into the live result.
    const out = pickColumns(columns, rows, null);
    out.rows[0]![0] = 'mutated';
    expect(rows[0]![0]).toBe(1);
  });

  it('feeds toTsv to produce a reordered subset copy', () => {
    const out = pickColumns(columns, rows, [2, 0]);
    expect(toTsv(out.columns, out.rows)).toBe('city\tid\r\nDenver\t1\r\nAustin\t2');
  });
});

describe('sliceGridRange — rectangular selection', () => {
  const columns = ['id', 'name', 'city'];
  const rows = [
    [1, 'Alice', 'Denver'],
    [2, 'Bob', 'Austin'],
    [3, 'Cara', 'Miami'],
  ];

  it('copies a single cell', () => {
    const out = sliceGridRange(columns, rows, { row0: 0, row1: 0, col0: 1, col1: 1 });
    expect(out.columns).toEqual(['name']);
    expect(out.rows).toEqual([['Alice']]);
    expect(toTsv(null, out.rows)).toBe('Alice');
  });

  it('copies a block of cells with their headers', () => {
    const out = sliceGridRange(columns, rows, { row0: 0, row1: 1, col0: 1, col1: 2 });
    expect(out.columns).toEqual(['name', 'city']);
    expect(out.rows).toEqual([
      ['Alice', 'Denver'],
      ['Bob', 'Austin'],
    ]);
    expect(toTsv(out.columns, out.rows)).toBe('name\tcity\r\nAlice\tDenver\r\nBob\tAustin');
  });

  it('copies headers only when rows are omitted by the caller', () => {
    const out = sliceGridRange(columns, rows, { row0: 0, row1: 0, col0: 0, col1: 2 });
    expect(toTsv(out.columns, [])).toBe('id\tname\tcity');
  });

  it('normalises an inverted drag', () => {
    const out = sliceGridRange(columns, rows, { row0: 2, row1: 1, col0: 2, col1: 1 });
    expect(out.columns).toEqual(['name', 'city']);
    expect(out.rows).toEqual([
      ['Bob', 'Austin'],
      ['Cara', 'Miami'],
    ]);
  });

  it('follows display order so a reordered grid copies what is on screen', () => {
    const out = sliceGridRange(columns, rows, { row0: 0, row1: 0, col0: 0, col1: 1 }, [2, 0, 1]);
    expect(out.columns).toEqual(['city', 'id']);
    expect(out.rows).toEqual([['Denver', 1]]);
  });

  it('clamps off the edge of the grid', () => {
    const out = sliceGridRange(columns, rows, { row0: -4, row1: 99, col0: -1, col1: 99 });
    expect(out.columns).toEqual(columns);
    expect(out.rows).toEqual(rows);
  });

  it('returns empty when the grid has no rows', () => {
    expect(sliceGridRange(columns, [], { row0: 0, row1: 0, col0: 0, col1: 1 })).toEqual({
      columns: [],
      rows: [],
    });
  });
});

describe('toTsv — value coercion', () => {
  it('pastes NULL and undefined as empty cells', () => {
    // The grid renders NULL as the word "NULL"; copying that literal would
    // turn a numeric column into text on paste.
    expect(toTsv(null, [[null, undefined, 0]])).toBe('\t\t0');
  });

  it('keeps zero and false rather than treating them as empty', () => {
    expect(toTsv(null, [[0, false, '']])).toBe('0\tfalse\t');
  });

  it('renders numbers and bigints without notation loss', () => {
    expect(toTsv(null, [[42, 10n, 1.5]])).toBe('42\t10\t1.5');
  });

  it('serialises dates via String() so the cell is readable', () => {
    const d = new Date('2026-08-09T00:00:00.000Z');
    expect(toTsv(null, [[d]])).toBe(String(d));
  });

  it('pads nothing — a short row stays short', () => {
    // Ragged rows are the caller's concern; copy must not invent cells.
    expect(toTsv(['a', 'b'], [[1]])).toBe('a\tb\r\n1');
  });
});
