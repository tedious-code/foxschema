import { PASSWORD_PLACEHOLDER } from './access';

/** One-time password suggestion — never persisted by Fox Schema. */
export function generateSuggestedPassword(length = 20): string {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * MySQL and MariaDB treat a backslash as an escape character inside a string
 * literal; the SQL standard does not, and PostgreSQL, Oracle, SQL Server and
 * Db2 follow the standard.
 *
 * This only started mattering once a password could be typed. Generated ones
 * are drawn from a charset with no backslash in it, so doubling quotes was
 * enough. A typed `pa\ssword` on MySQL becomes `pa` + an escape — the account
 * is created with a password nobody can reproduce, and the failure appears
 * later as a login that will not work.
 */
function backslashIsEscape(dialect?: string): boolean {
  const d = (dialect || '').toLowerCase();
  // ClickHouse belongs here too: its CREATE USER quotes the password the same
  // way and it interprets the same escapes. Verified against a live server — a
  // typed `pa\tss1` written unescaped stores a tab, and authenticating with
  // what was typed fails.
  return d === 'mysql' || d === 'mariadb' || d === 'tidb' || d === 'clickhouse';
}

/**
 * Substitute the placeholder with a real password.
 *
 * Only replaces the placeholder inside quotes — the form account DDL emits —
 * so a principal whose name literally contains `<password>` is not rewritten.
 */
export function sqlWithPasswordSubstitute(
  sql: string,
  password: string,
  dialect?: string
): string {
  const single = `'${PASSWORD_PLACEHOLDER}'`;
  const double = `"${PASSWORD_PLACEHOLDER}"`;
  // Backslashes first: doubling them after the quotes would also double the
  // backslashes this step introduces.
  const escaped = backslashIsEscape(dialect) ? password.replace(/\\/g, '\\\\') : password;
  const singlePw = `'${escaped.replace(/'/g, "''")}'`;
  const doublePw = `"${escaped.replace(/"/g, '""')}"`;
  return sql.split(single).join(singlePw).split(double).join(doublePw);
}

export function sqlNeedsPassword(sql: string): boolean {
  return (
    sql.includes(`'${PASSWORD_PLACEHOLDER}'`) || sql.includes(`"${PASSWORD_PLACEHOLDER}"`)
  );
}
