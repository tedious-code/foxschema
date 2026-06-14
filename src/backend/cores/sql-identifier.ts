// Conservative SQL identifier allowlist (DB2/Postgres unquoted identifiers):
// must start with a letter or underscore, then letters/digits/_ $ # @.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$#@]*$/;

/**
 * Guards against SQL injection where an identifier is interpolated into a
 * statement that can't be parameterized (e.g. SET CURRENT SCHEMA / search_path).
 * Returns the trimmed value, or throws on anything that isn't a bare identifier.
 */
export function assertSafeIdentifier(name: string, kind = 'identifier'): string {
  const trimmed = (name ?? '').trim();
  if (!IDENTIFIER.test(trimmed)) {
    throw new Error(`Unsafe ${kind}: "${name}". Only letters, digits, and _ $ # @ are allowed.`);
  }
  return trimmed;
}
