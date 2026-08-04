import { describe, expect, it } from 'vitest';
import {
  findSelectListRange,
  insertIntoSelectList,
  isSelectOrFromKeyword,
} from './selectClauseEdit';

describe('selectClauseEdit', () => {
  it('finds the SELECT list before FROM', () => {
    const sql = 'SELECT a, b FROM t';
    const r = findSelectListRange(sql);
    expect(r).not.toBeNull();
    expect(sql.slice(r!.listStart, r!.listEnd).trim()).toBe('a, b');
  });

  it('replaces bare * and appends additional columns', () => {
    expect(insertIntoSelectList('SELECT * FROM t', 'u.id')).toBe('SELECT u.id FROM t');
    expect(insertIntoSelectList('SELECT u.id FROM t', 'u.email')).toBe(
      'SELECT u.id, u.email FROM t'
    );
  });

  it('detects SELECT/FROM keyword under the caret', () => {
    const sql = 'SELECT * FROM t';
    expect(isSelectOrFromKeyword(sql, 0)).toBe('select');
    expect(isSelectOrFromKeyword(sql, 9)).toBe('from');
    expect(isSelectOrFromKeyword(sql, 14)).toBeNull();
  });
});
