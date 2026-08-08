/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * One canonical text form for a result-grid cell, shared by cell comparison
 * (`resultValuesEqual`) and row matching (`rowKey`).
 *
 * These two had drifted apart, and each drift was a bug: cell comparison
 * understood objects but not booleans, so a Postgres `boolean` never equalled
 * a MySQL `TINYINT(1)` and every boolean column showed a diff that migrating
 * could not clear. Row matching understood neither, so an object-valued key
 * stringified to `"[object Object]"` and paired unrelated rows together.
 *
 * The job here is to absorb *representation* differences between drivers
 * without absorbing real value differences. That line is the whole design:
 * `true` and `1` are one value wearing two dialect hats; `'007'` and `7` are
 * two different values, and collapsing them would pair the wrong rows.
 */

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

/**
 * Plain decimal, no exponent, no leading zeros, no surrounding space.
 *
 * Leading zeros are excluded deliberately. `'007'` in a text key is a distinct
 * value from `7`; normalising it would reintroduce the row-pairing bug this
 * module exists to fix. Exponent form (`'1e3'`) is excluded for the same
 * reason — it is only ever a string a human typed, never a driver's numeric
 * rendering.
 *
 * Scanned rather than matched with `/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/`: that shape
 * nests a quantifier inside an optional group, which is what
 * `security/detect-unsafe-regex` rejects, and this runs per cell per compare.
 */
function isCanonicalDecimal(text: string): boolean {
  let i = text.startsWith('-') ? 1 : 0;
  const intStart = i;
  while (isDigit(text[i])) i += 1;
  const intLength = i - intStart;
  if (intLength === 0) return false;
  // `0` alone is fine; `007` is a distinct text value, not the number 7.
  if (intLength > 1 && text[intStart] === '0') return false;
  if (i === text.length) return true;
  if (text[i] !== '.') return false;
  i += 1;
  const fracStart = i;
  while (isDigit(text[i])) i += 1;
  return i === text.length && i > fracStart;
}

/** `1.50` → `1.5`, `2.0` → `2`. Leaves anything non-canonical alone. */
function trimDecimalScale(text: string): string {
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  // `-0` and `-0.0` collapse to `0`, matching how the drivers report zero.
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * Key order must not decide identity: Postgres `jsonb` reorders keys on
 * storage while `json` preserves insertion order, so the same logical value
 * can arrive with different property order from two servers.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Canonical text for a cell, or `null` for SQL NULL.
 *
 * `null` is returned rather than a string so callers can decide what NULL
 * means for them — equal to another NULL when comparing, but never a usable
 * row key.
 */
export function normalizeResultValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  // Dialect hats for the same value: pg `boolean` vs MySQL `TINYINT(1)` vs
  // SQL Server `BIT`. Fold to 1/0 so all three agree.
  if (typeof value === 'boolean') return value ? '1' : '0';

  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? 'Invalid Date' : value.toISOString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return trimDecimalScale(String(value));
  }

  if (typeof value === 'string') {
    // Numeric-looking text is normalised only in canonical form, so DECIMAL
    // scale differences ('1.50' vs '1.5') fold while text keys do not.
    return isCanonicalDecimal(value) ? trimDecimalScale(value) : value;
  }

  if (typeof value === 'object') {
    try {
      return stableStringify(value);
    } catch {
      // Cyclic or otherwise unserialisable: fall back to something stable and
      // obviously not a real value rather than throwing mid-compare.
      return '[unserializable]';
    }
  }

  return String(value);
}
