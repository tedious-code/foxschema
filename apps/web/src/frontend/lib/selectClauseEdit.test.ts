import { describe, expect, it } from 'vitest';
import {
  addTableWithAliasToFrom,
  clearSelectList,
  currentSelectListItems,
  findSelectListRange,
  insertIntoSelectList,
  isSelectOrFromKeyword,
  parseSelectListItems,
  removeFromSelectList,
  selectListIsStar,
  setSelectListToStar,
  suggestTableAlias,
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

  it('does not duplicate an already-selected column', () => {
    expect(insertIntoSelectList('SELECT u.id FROM t u', 'u.id')).toBe('SELECT u.id FROM t u');
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

  it('parses select list items ignoring commas inside calls', () => {
    expect(parseSelectListItems('a, func(x, y), b')).toEqual(['a', 'func(x, y)', 'b']);
  });

  it('setSelectListToStar and clearSelectList', () => {
    expect(setSelectListToStar('SELECT u.id, u.email FROM t u')).toBe('SELECT * FROM t u');
    expect(selectListIsStar('SELECT * FROM t')).toBe(true);
    expect(clearSelectList('SELECT u.id FROM t u')).toBe('SELECT FROM t u');
    expect(currentSelectListItems('SELECT u.id, u.email FROM t u')).toEqual(['u.id', 'u.email']);
  });

  it('removeFromSelectList drops one expression', () => {
    expect(removeFromSelectList('SELECT u.id, u.email FROM t u', 'u.id')).toBe(
      'SELECT u.email FROM t u'
    );
    expect(removeFromSelectList('SELECT u.id FROM t u', 'u.id')).toBe('SELECT FROM t u');
  });

  it('suggestTableAlias builds short unique aliases', () => {
    expect(suggestTableAlias('users', new Set())).toBe('u');
    expect(suggestTableAlias('order_items', new Set())).toBe('oi');
    expect(suggestTableAlias('users', new Set(['u']))).toBe('u2');
  });

  it('addTableWithAliasToFrom creates SELECT * FROM table alias', () => {
    const empty = addTableWithAliasToFrom('', 'users');
    expect(empty.added).toBe(true);
    expect(empty.sql).toMatch(/^SELECT \*\nFROM users \w+$/);

    const next = addTableWithAliasToFrom(empty.sql, 'orders');
    expect(next.added).toBe(true);
    expect(next.sql).toContain('FROM users');
    expect(next.sql).toContain(', orders');

    const again = addTableWithAliasToFrom(empty.sql, 'users');
    expect(again.added).toBe(false);
    expect(again.alias).toBe(empty.alias);
  });
});
