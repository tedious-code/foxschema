import { PASSWORD_PLACEHOLDER } from './access';

/** One-time password suggestion — never persisted by Fox Schema. */
export function generateSuggestedPassword(length = 20): string {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Substitute placeholder for clipboard copy only; preview SQL stays unchanged.
 *
 * Only replace the placeholder inside quotes — the form account DDL emits —
 * so a principal whose name literally contains `<password>` is not rewritten.
 */
export function sqlWithPasswordSubstitute(sql: string, password: string): string {
  const single = `'${PASSWORD_PLACEHOLDER}'`;
  const double = `"${PASSWORD_PLACEHOLDER}"`;
  // Generated passwords never include quotes; still escape so a future charset
  // change cannot break out of the string literal.
  const singlePw = `'${password.replace(/'/g, "''")}'`;
  const doublePw = `"${password.replace(/"/g, '""')}"`;
  return sql.split(single).join(singlePw).split(double).join(doublePw);
}

export function sqlNeedsPassword(sql: string): boolean {
  return (
    sql.includes(`'${PASSWORD_PLACEHOLDER}'`) || sql.includes(`"${PASSWORD_PLACEHOLDER}"`)
  );
}
