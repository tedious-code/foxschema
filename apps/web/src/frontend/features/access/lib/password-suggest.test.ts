import { describe, it, expect } from 'vitest';
import {
  generateSuggestedPassword,
  sqlNeedsPassword,
  sqlWithPasswordSubstitute,
} from './password-suggest';
import { PASSWORD_PLACEHOLDER } from './access';

describe('password-suggest', () => {
  it('generates passwords of requested length', () => {
    expect(generateSuggestedPassword(16)).toHaveLength(16);
  });

  it('substitutes placeholder for clipboard copy only', () => {
    const sql = `CREATE USER x IDENTIFIED BY '${PASSWORD_PLACEHOLDER}';`;
    expect(sqlWithPasswordSubstitute(sql, 'Secret1!')).toBe(
      "CREATE USER x IDENTIFIED BY 'Secret1!';"
    );
    expect(sql).toContain(PASSWORD_PLACEHOLDER);
  });

  it('does not rewrite a principal name that contains the placeholder text', () => {
    const name = `svc${PASSWORD_PLACEHOLDER}`;
    const sql = `DROP USER "${name}";`;
    expect(sqlNeedsPassword(sql)).toBe(false);
    expect(sqlWithPasswordSubstitute(sql, 'Generated1!')).toBe(sql);
  });

  it('still substitutes Oracle double-quoted placeholders', () => {
    const sql = `CREATE USER "X" IDENTIFIED BY "${PASSWORD_PLACEHOLDER}";`;
    expect(sqlNeedsPassword(sql)).toBe(true);
    expect(sqlWithPasswordSubstitute(sql, 'Secret1!')).toBe(
      'CREATE USER "X" IDENTIFIED BY "Secret1!";'
    );
  });

  it('detects when SQL still needs a password', () => {
    expect(sqlNeedsPassword(`pw = '${PASSWORD_PLACEHOLDER}'`)).toBe(true);
    expect(sqlNeedsPassword('SELECT 1')).toBe(false);
  });
});
