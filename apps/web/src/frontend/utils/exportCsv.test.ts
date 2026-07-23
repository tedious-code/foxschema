import { describe, expect, it } from 'vitest';
import { toCsv } from '../utils/exportCsv';

describe('exportCsv', () => {
  it('escapes quotes, commas, and newlines', () => {
    expect(toCsv(['a', 'b'], [['x', 'y']])).toBe('a,b\nx,y');
    expect(toCsv(['name'], [['say "hi"']])).toBe('name\n"say ""hi"""');
    expect(toCsv(['c'], [['a,b']])).toBe('c\n"a,b"');
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\n,');
  });
});
