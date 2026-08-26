/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * A deliberately tiny SQL grammar, parsed into an intent a non-SQL store can
 * carry out.
 *
 * MongoDB and Redis do not speak SQL — the official drivers take MQL documents
 * and RESP commands. Making them work behind the SQL editor and data-migrate
 * therefore means translating, and translating means parsing. Parsing *all* of
 * SQL is a project; parsing what this application actually emits is not.
 *
 * Data migrate only ever produces three shapes, each with equality predicates
 * on key columns (see rowDml.ts):
 *
 *   INSERT INTO t (a, b) VALUES (?, ?)
 *   UPDATE t SET a = ? WHERE k = ? AND k2 = ?
 *   DELETE FROM t WHERE k = ? AND k2 = ?
 *
 * plus `SELECT … FROM t [WHERE …] [LIMIT n]` for browsing. That is the whole
 * surface, and it maps cleanly onto find/insert/update/delete in either store.
 *
 * ## Everything else is refused, on purpose
 *
 * The dangerous failure for a translator is not rejecting valid SQL — it is
 * *accepting* SQL it only partly understands. `DELETE FROM t WHERE age > 65`
 * with the predicate silently dropped empties the collection. So this parser
 * fails closed: anything it cannot represent exactly returns an error, and the
 * caller must refuse to execute rather than approximate.
 *
 * That is why there are no ranges, no OR, no joins, no subqueries, no
 * functions and no expressions here. Not "not yet" — admitting any of them
 * means the intent can no longer be checked by inspection.
 */

export interface SubsetColumnEq {
  column: string;
  /** Index into the statement's bind parameters, or a literal value. */
  value: SubsetValue;
}

export type SubsetValue =
  | { kind: 'param'; index: number }
  | { kind: 'literal'; value: string | number | null | boolean };

export type SubsetIntent =
  | { kind: 'select'; table: string; columns: string[] | '*'; where: SubsetColumnEq[]; limit?: number }
  | { kind: 'insert'; table: string; assignments: SubsetColumnEq[] }
  | { kind: 'update'; table: string; set: SubsetColumnEq[]; where: SubsetColumnEq[] }
  | { kind: 'delete'; table: string; where: SubsetColumnEq[] };

export type SubsetParse =
  | { ok: true; intent: SubsetIntent }
  | { ok: false; error: string };

/** Unwrap "x", `x`, [x] — the quoting styles the generators emit. */
function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
    if (s.startsWith('`') && s.endsWith('`')) return s.slice(1, -1).replace(/``/g, '`');
    if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).replace(/\]\]/g, ']');
  }
  return s;
}

/** `schema.table` → `table`; a non-SQL store has one namespace. */
function tableName(raw: string): string {
  const parts = raw.trim().split('.').map(unquote).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * A bind placeholder in any dialect's spelling, or a simple literal.
 *
 * Anything else — an expression, a function call, a nested SELECT — is not a
 * value this can represent, and returns null so the caller refuses.
 */
function parseValue(raw: string, nextParamIndex: () => number): SubsetValue | null {
  const s = raw.trim();
  if (!s) return null;
  // $1 / ? / :1 — the three placeholder styles renderSqlQuery emits.
  if (s === '?') return { kind: 'param', index: nextParamIndex() };
  const dollar = /^\$(\d+)$/.exec(s);
  if (dollar) return { kind: 'param', index: Number(dollar[1]) - 1 };
  const colon = /^:(\d+)$/.exec(s);
  if (colon) return { kind: 'param', index: Number(colon[1]) - 1 };

  if (/^NULL$/i.test(s)) return { kind: 'literal', value: null };
  if (/^TRUE$/i.test(s)) return { kind: 'literal', value: true };
  if (/^FALSE$/i.test(s)) return { kind: 'literal', value: false };
  // Plain decimal only — no exponent, no sign games, no expressions.
  if (/^-?\d+$/.test(s)) return { kind: 'literal', value: Number(s) };
  if (/^-?\d+\.\d+$/.test(s)) return { kind: 'literal', value: Number(s) };
  // Single-quoted string with '' escaping.
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return { kind: 'literal', value: s.slice(1, -1).replace(/''/g, "'") };
  }
  return null;
}

/**
 * Split on a separator that appears at paren depth 0 and outside quotes.
 * Keeps `('a, b')` and `f(x, y)` from being cut in the middle.
 */
function splitTop(text: string, separator: RegExp): string[] | null {
  const out: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch === inQuote) {
        if (text[i + 1] === inQuote) i++;
        else inQuote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inQuote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return null;
    } else if (depth === 0) {
      separator.lastIndex = 0;
      const m = separator.exec(text.slice(i));
      if (m && m.index === 0) {
        out.push(text.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  if (depth !== 0 || inQuote) return null;
  out.push(text.slice(start));
  return out;
}

/**
 * A bare field reference: `name`, `user_id`, `profile.city`.
 *
 * Deliberately strict. Anything with parentheses, operators or spaces is an
 * expression, and an expression in the column position cannot be turned into
 * a document field without evaluating it.
 */
function isPlainFieldRef(name: string): boolean {
  if (!name) return false;
  // Split rather than match `(?:\.[A-Za-z_$][\w$]*)*` — nesting a quantifier
  // inside a repeated group is the shape security/detect-unsafe-regex rejects,
  // and this runs per predicate per statement.
  const segments = name.split('.');
  return segments.every((segment) => SEGMENT.test(segment));
}

/** One identifier segment. No nesting, so no backtracking to worry about. */
const SEGMENT = /^[A-Za-z_$][\w$]*$/;

/** `a = ? AND b = ?` → equality pairs, or null if anything else appears. */
function parseEqualityList(
  text: string,
  separator: RegExp,
  nextParamIndex: () => number
): SubsetColumnEq[] | null {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = splitTop(trimmed, separator);
  if (!parts) return null;
  const out: SubsetColumnEq[] = [];
  for (const part of parts) {
    // Exactly `column = value`. Any other operator is outside the subset, and
    // treating `>=` as `=` would silently match the wrong rows.
    const eq = part.indexOf('=');
    if (eq < 0) return null;
    const before = part.slice(0, eq).trim();
    const after = part.slice(eq + 1).trim();
    // Reject compound operators: `>=`, `<=`, `!=`, `<>`.
    if (/[<>!]$/.test(before)) return null;
    const column = unquote(before);
    // Must be a plain field reference. Rejecting only whitespace was not
    // enough: `lower(a)` has none and sailed through as a column name, which
    // would have matched on a field that does not exist. A dot is allowed —
    // it addresses a nested field in a document store.
    if (!isPlainFieldRef(column)) return null;
    const value = parseValue(after, nextParamIndex);
    if (!value) return null;
    out.push({ column, value });
  }
  return out;
}

/**
 * WHERE `column = NULL` is not SQL equality (that needs IS NULL), and on MongoDB
 * `{ field: null }` also matches documents where the field is missing — so a
 * DELETE/UPDATE would over-match. Refuse it the same way IS NULL is refused.
 * SET/INSERT may still assign NULL.
 */
function whereHasNullLiteral(where: SubsetColumnEq[]): boolean {
  return where.some((w) => w.value.kind === 'literal' && w.value.value === null);
}

const WHERE_NULL_REFUSED =
  'Equality to NULL is not supported on this store (SQL uses IS NULL; document stores treat null as matching missing fields).';

const AND = /^\s+AND\s+/i;
const COMMA = /^\s*,\s*/;

/**
 * Parse one statement into an intent, or explain why it is out of subset.
 *
 * The caller is expected to treat `ok: false` as "refuse to run", never as
 * "run it some other way".
 */
export function parseSqlSubset(sql: string): SubsetParse {
  const text = sql.trim().replace(/;\s*$/, '');
  if (!text) return { ok: false, error: 'Empty statement.' };

  // One statement only. A batch here would translate the first and drop the
  // rest, which is exactly the silent-partial-success this must not do.
  if (splitTop(text, /^;/) === null) {
    return { ok: false, error: 'Unbalanced quotes or parentheses.' };
  }
  const statements = splitTop(text, /^;/);
  if (statements && statements.filter((s) => s.trim()).length > 1) {
    return { ok: false, error: 'Only one statement at a time is supported on this store.' };
  }

  let paramCursor = 0;
  const nextParamIndex = () => paramCursor++;

  const select = /^SELECT\s+([\s\S]+?)\s+FROM\s+([^\s]+)([\s\S]*)$/i.exec(text);
  if (select) {
    const [, cols, table, tail] = select;
    const columns =
      cols!.trim() === '*'
        ? ('*' as const)
        : (splitTop(cols!, COMMA)?.map(unquote) ?? null);
    if (columns === null) return { ok: false, error: 'Could not read the column list.' };
    let rest = (tail ?? '').trim();
    let limit: number | undefined;
    const limitMatch = /\s*LIMIT\s+(\d+)\s*$/i.exec(rest);
    if (limitMatch) {
      limit = Number(limitMatch[1]);
      rest = rest.slice(0, limitMatch.index).trim();
    }
    let where: SubsetColumnEq[] = [];
    if (rest) {
      const w = /^WHERE\s+([\s\S]+)$/i.exec(rest);
      if (!w) return { ok: false, error: `Unsupported clause: ${rest.slice(0, 40)}` };
      const parsed = parseEqualityList(w[1]!, AND, nextParamIndex);
      if (!parsed) {
        return {
          ok: false,
          error: 'Only `column = value` predicates joined by AND are supported on this store.',
        };
      }
      if (whereHasNullLiteral(parsed)) return { ok: false, error: WHERE_NULL_REFUSED };
      where = parsed;
    }
    return { ok: true, intent: { kind: 'select', table: tableName(table!), columns, where, limit } };
  }

  const insert = /^INSERT\s+INTO\s+(\S+)\s*\(([\s\S]+?)\)\s*VALUES\s*\(([\s\S]+?)\)$/i.exec(text);
  if (insert) {
    const [, table, colText, valText] = insert;
    const cols = splitTop(colText!, COMMA)?.map(unquote);
    const vals = splitTop(valText!, COMMA);
    if (!cols || !vals || cols.length !== vals.length) {
      return { ok: false, error: 'INSERT column and value counts differ.' };
    }
    const assignments: SubsetColumnEq[] = [];
    for (let i = 0; i < cols.length; i++) {
      const value = parseValue(vals[i]!, nextParamIndex);
      if (!value) return { ok: false, error: `Unsupported value in INSERT: ${vals[i]!.trim()}` };
      assignments.push({ column: cols[i]!, value });
    }
    return { ok: true, intent: { kind: 'insert', table: tableName(table!), assignments } };
  }

  const update = /^UPDATE\s+(\S+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i.exec(text);
  if (update) {
    const [, table, setText, whereText] = update;
    const set = parseEqualityList(setText!, COMMA, nextParamIndex);
    if (!set || set.length === 0) {
      return { ok: false, error: 'Only `column = value` assignments are supported in SET.' };
    }
    const where = parseEqualityList(whereText!, AND, nextParamIndex);
    if (!where || where.length === 0) {
      return {
        ok: false,
        error: 'Only `column = value` predicates joined by AND are supported on this store.',
      };
    }
    if (whereHasNullLiteral(where)) return { ok: false, error: WHERE_NULL_REFUSED };
    return { ok: true, intent: { kind: 'update', table: tableName(table!), set, where } };
  }

  // An UPDATE with no WHERE would rewrite the whole collection.
  if (/^UPDATE\s/i.test(text)) {
    return { ok: false, error: 'UPDATE without a WHERE clause is refused on this store.' };
  }

  const del = /^DELETE\s+FROM\s+(\S+)\s+WHERE\s+([\s\S]+)$/i.exec(text);
  if (del) {
    const [, table, whereText] = del;
    const where = parseEqualityList(whereText!, AND, nextParamIndex);
    if (!where || where.length === 0) {
      return {
        ok: false,
        error: 'Only `column = value` predicates joined by AND are supported on this store.',
      };
    }
    if (whereHasNullLiteral(where)) return { ok: false, error: WHERE_NULL_REFUSED };
    return { ok: true, intent: { kind: 'delete', table: tableName(table!), where } };
  }

  if (/^DELETE\s/i.test(text)) {
    return { ok: false, error: 'DELETE without a WHERE clause is refused on this store.' };
  }

  return {
    ok: false,
    error:
      'This store supports only single-table SELECT / INSERT / UPDATE / DELETE with `column = value` predicates.',
  };
}

/** Resolve an intent's values against the statement's bind parameters. */
export function subsetValue(value: SubsetValue, params: readonly unknown[]): unknown {
  return value.kind === 'literal' ? value.value : (params[value.index] ?? null);
}
