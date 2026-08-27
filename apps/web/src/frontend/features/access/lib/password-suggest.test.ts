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

  it('detects when SQL still needs a password', () => {
    expect(sqlNeedsPassword(`pw = '${PASSWORD_PLACEHOLDER}'`)).toBe(true);
    expect(sqlNeedsPassword('SELECT 1')).toBe(false);
  });
});
