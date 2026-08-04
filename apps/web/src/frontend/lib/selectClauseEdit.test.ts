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

  it('skips DISTINCT / TOP n / TOP n PERCENT before the list', () => {
    const listOf = (sql: string) => {
      const r = findSelectListRange(sql);
      return r ? sql.slice(r.listStart, r.listEnd).trim() : null;
    };
    expect(listOf('SELECT DISTINCT a, b FROM t')).toBe('a, b');
    expect(listOf('SELECT TOP 10 a FROM t')).toBe('a');
    expect(listOf('SELECT TOP 10 PERCENT a FROM t')).toBe('a');
    // `10x` is not a TOP count, so nothing is skipped.
    expect(listOf('SELECT top10x FROM t')).toBe('top10x');
  });

  it('detects SELECT/FROM keyword under the caret', () => {
    const sql = 'SELECT * FROM t';
    expect(isSelectOrFromKeyword(sql, 0)).toBe('select');
    expect(isSelectOrFromKeyword(sql, 9)).toBe('from');
    expect(isSelectOrFromKeyword(sql, 14)).toBeNull();
  });
});
