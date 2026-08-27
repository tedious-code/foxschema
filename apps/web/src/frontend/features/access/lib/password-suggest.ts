import { PASSWORD_PLACEHOLDER } from './access';

/** One-time password suggestion — never persisted by Fox Schema. */
export function generateSuggestedPassword(length = 20): string {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Substitute placeholder for clipboard copy only; preview SQL stays unchanged. */
export function sqlWithPasswordSubstitute(sql: string, password: string): string {
  return sql.split(PASSWORD_PLACEHOLDER).join(password);
}

export function sqlNeedsPassword(sql: string): boolean {
  return sql.includes(PASSWORD_PLACEHOLDER);
}
