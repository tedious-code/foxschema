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

describe('escaping a typed password', () => {
  // Generated passwords are drawn from a charset with no quote and no
  // backslash in it, so escaping never mattered until the reader could type
  // one. These are the characters that change the meaning of the literal.
  const sqlOf = (pw: string, dialect?: string) =>
    sqlWithPasswordSubstitute(
      `CREATE USER x IDENTIFIED BY '${PASSWORD_PLACEHOLDER}';`,
      pw,
      dialect
    );

  it('doubles a single quote so the literal cannot be closed early', () => {
    expect(sqlOf("pa'ss")).toBe("CREATE USER x IDENTIFIED BY 'pa''ss';");
  });

  it('doubles a backslash on ClickHouse too', () => {
    // Verified against a live server: `CREATE USER … BY 'pa\tss1'` written
    // unescaped stores a tab, and authenticating with what was typed fails
    // with AUTHENTICATION_FAILED.
    expect(sqlOf('pa\\ss', 'clickhouse')).toBe("CREATE USER x IDENTIFIED BY 'pa\\\\ss';");
  });

  it('doubles a backslash on MySQL, where it is an escape character', () => {
    // MySQL reads `pa\ss` as `pa` + an escape: the account ends up with a
    // password nobody can reproduce, and it surfaces later as a login that
    // will not work.
    expect(sqlOf('pa\\ss', 'mysql')).toBe("CREATE USER x IDENTIFIED BY 'pa\\\\ss';");
    expect(sqlOf('pa\\ss', 'mariadb')).toBe("CREATE USER x IDENTIFIED BY 'pa\\\\ss';");
  });

  it('leaves a backslash alone where it is a literal character', () => {
    // PostgreSQL, Oracle, SQL Server and Db2 follow the standard: doubling
    // here would set a password with an extra backslash in it.
    for (const dialect of ['postgres', 'oracle', 'sqlserver', 'db2', undefined]) {
      expect(sqlOf('pa\\ss', dialect)).toBe("CREATE USER x IDENTIFIED BY 'pa\\ss';");
    }
  });

  it('does not double the backslashes it just introduced', () => {
    // Escaping quotes after backslashes would turn one backslash into four.
    expect(sqlOf("a\\'b", 'mysql')).toBe("CREATE USER x IDENTIFIED BY 'a\\\\''b';");
  });
});
