import { describe, it, expect } from 'vitest';
import { toPostgresPlaceholders, toMysqlIdentifiers } from './sql-dialect';

describe('Postgres placeholder rewriting', () => {
  it('numbers ? placeholders left to right', () => {
    expect(toPostgresPlaceholders('INSERT INTO t (a, b, c) VALUES (?, ?, ?)')).toBe(
      'INSERT INTO t (a, b, c) VALUES ($1, $2, $3)'
    );
  });

  it('leaves quoted identifiers untouched', () => {
    expect(toPostgresPlaceholders('SELECT "schema" FROM connections WHERE id = ?')).toBe(
      'SELECT "schema" FROM connections WHERE id = $1'
    );
  });

  it('handles no placeholders', () => {
    expect(toPostgresPlaceholders('SELECT 1')).toBe('SELECT 1');
  });
});

describe('MySQL identifier rewriting', () => {
  it('converts standard double-quoted identifiers to backticks', () => {
    expect(toMysqlIdentifiers('SELECT "key", "value" FROM app_settings')).toBe('SELECT `key`, `value` FROM app_settings');
  });

  it('leaves ? placeholders untouched', () => {
    expect(toMysqlIdentifiers('UPDATE connections SET "schema" = ? WHERE id = ?')).toBe(
      'UPDATE connections SET `schema` = ? WHERE id = ?'
    );
  });
});
