/**
 * Per-dialect SQL rewriting. Modules write one portable SQL string using `?`
 * placeholders and standard double-quoted identifiers; each provider rewrites it.
 */

/** `?, ?, …` → Postgres `$1, $2, …` (left to right). */
export function toPostgresPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Standard `"ident"` quotes → MySQL backticks. Values use `?`, never `"`. */
export function toMysqlIdentifiers(sql: string): string {
  return sql.replace(/"([^"]+)"/g, '`$1`');
}
