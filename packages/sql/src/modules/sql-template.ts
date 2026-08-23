/**
 * Safe SQL construction for code cells: a tagged template whose `${…}`
 * interpolations become **bind parameters**, never text.
 *
 *   sql`SELECT * FROM users WHERE id = ${id}`      → "… id = $1",  [id]
 *   sql`INSERT INTO t ${sql.values(rows)}`         → "… VALUES ($1,$2),($3,$4)"
 *   sql`DELETE FROM ${sql.id(name)} WHERE x = ${v}` → identifier quoted, v bound
 *
 * Why not string interpolation: a value containing `'` ends the literal and
 * changes the statement, `null` becomes the bare word null, Date becomes a
 * locale string most engines reject, and an object becomes "[object Object]".
 * Binding hands the value to the driver as data, so none of that can happen.
 *
 * `sql.raw()` exists for genuinely dynamic SQL and is deliberately explicit —
 * it is the one construct that puts caller text straight into the statement.
 */

/** Placeholder syntax per engine family. */
export type SqlPlaceholderStyle = 'dollar' | 'question' | 'colon';

// ClickHouse's adapter substitutes `$N` (string-escaped) — it does not bind `?`.
// Emitting question-mark placeholders left peek FK drills and `sql\`…\`` cells
// unbound ("Syntax error … failed at position") while catalog probes that
// already used `$1` worked. Keep ClickHouse on dollar so every path matches.
const DOLLAR_DIALECTS = new Set([
  'postgres',
  'redshift',
  'cockroachdb',
  'yugabytedb',
  'clickhouse',
]);
const COLON_DIALECTS = new Set(['oracle']);
const BACKTICK_DIALECTS = new Set(['mysql', 'mariadb', 'tidb', 'clickhouse']);
const BRACKET_DIALECTS = new Set(['sqlserver', 'azuresql']);

export function placeholderStyleFor(dialect: string): SqlPlaceholderStyle {
  const d = dialect.toLowerCase();
  if (DOLLAR_DIALECTS.has(d)) return 'dollar';
  if (COLON_DIALECTS.has(d)) return 'colon';
  return 'question';
}

/** `index` is 1-based. */
export function renderPlaceholder(style: SqlPlaceholderStyle, index: number): string {
  if (style === 'dollar') return `$${index}`;
  if (style === 'colon') return `:${index}`;
  return '?';
}

/**
 * Quote an identifier for `dialect`. Mirrors the SQL editor's `quoteIdent` —
 * engines cannot bind identifiers, so this is the only safe way to make a
 * table/column name dynamic.
 */
export function quoteSqlIdentifier(name: string, dialect: string): string {
  const d = dialect.toLowerCase();
  if (BACKTICK_DIALECTS.has(d)) return '`' + name.replace(/`/g, '``') + '`';
  if (BRACKET_DIALECTS.has(d)) return '[' + name.replace(/]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

const FRAGMENT = Symbol.for('foxschema.sql.fragment');
const QUERY = Symbol.for('foxschema.sql.query');

type Fragment =
  | { [FRAGMENT]: true; kind: 'raw'; text: string }
  | { [FRAGMENT]: true; kind: 'identifier'; parts: string[] }
  | {
      [FRAGMENT]: true;
      kind: 'values';
      rows: Record<string, unknown>[];
      columns?: string[];
      /** Clause between the column list and VALUES, e.g. OVERRIDING SYSTEM VALUE. */
      between?: string;
    }
  | { [FRAGMENT]: true; kind: 'list'; values: unknown[] };

export interface SqlQuery {
  [QUERY]: true;
  strings: readonly string[];
  values: readonly unknown[];
}

function isFragment(v: unknown): v is Fragment {
  return typeof v === 'object' && v !== null && FRAGMENT in v;
}

export function isSqlQuery(v: unknown): v is SqlQuery {
  return typeof v === 'object' && v !== null && QUERY in v;
}

export interface RenderedSql {
  text: string;
  params: unknown[];
}

/** Column union across rows, in first-seen order (matches grid semantics). */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

/**
 * Flatten a tagged-template query into driver-ready `{ text, params }`.
 * Nested queries and fragments are expanded in place so composition works.
 */
export function renderSqlQuery(query: SqlQuery, dialect: string): RenderedSql {
  const style = placeholderStyleFor(dialect);
  const params: unknown[] = [];
  let text = '';

  const bind = (value: unknown): string => {
    params.push(value);
    return renderPlaceholder(style, params.length);
  };

  const emitValue = (value: unknown): void => {
    if (isSqlQuery(value)) {
      walk(value);
      return;
    }
    if (isFragment(value)) {
      if (value.kind === 'raw') {
        text += value.text;
        return;
      }
      if (value.kind === 'identifier') {
        text += value.parts.map((p) => quoteSqlIdentifier(p, dialect)).join('.');
        return;
      }
      if (value.kind === 'list') {
        text += `(${value.values.map(bind).join(', ')})`;
        return;
      }
      // values: a full `(cols) VALUES (…), (…)` tail for INSERT
      if (value.rows.length === 0) {
        // Emitting `() VALUES ` would surface as an opaque engine syntax error.
        // A migration loop hitting an empty batch should hear it plainly.
        throw new Error('sql.values() needs at least one row — guard the empty case in the cell');
      }
      const cols = value.columns ?? columnsOf(value.rows);
      if (cols.length === 0) {
        throw new Error('sql.values() rows have no columns');
      }
      const colList = cols.map((c) => quoteSqlIdentifier(c, dialect)).join(', ');
      const tuples = value.rows
        .map((row) => `(${cols.map((c) => bind(row[c] ?? null)).join(', ')})`)
        .join(', ');
      // `between` carries an engine clause that must sit after the column
      // list — Postgres/Db2 spell explicit identity writes that way. It is
      // caller-supplied SQL, so it is only ever set from a fixed capability
      // table, never from user input.
      const between = value.between ? `${value.between} ` : '';
      text += `(${colList}) ${between}VALUES ${tuples}`;
      return;
    }
    // A bare array is an IN-list — the single most common multi-value need.
    if (Array.isArray(value)) {
      text += `(${value.map(bind).join(', ')})`;
      return;
    }
    text += bind(value);
  };

  const walk = (q: SqlQuery): void => {
    q.strings.forEach((chunk, i) => {
      text += chunk;
      if (i < q.values.length) emitValue(q.values[i]);
    });
  };

  walk(query);
  return { text: text.trim(), params };
}

export interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): SqlQuery;
  /** Interpolate text verbatim. The only unescaped path — use deliberately. */
  raw(text: string): Fragment;
  /** A quoted identifier; `sql.id('public', 'users')` → `"public"."users"`. */
  id(...parts: string[]): Fragment;
  /** `(a, b) VALUES (?, ?), (?, ?)` from an array of objects. */
  values(rows: Record<string, unknown>[], columns?: string[], between?: string): Fragment;
  /** `(?, ?, ?)` for `IN` lists (a bare array does this too). */
  list(values: unknown[]): Fragment;
}

/** Build a `SqlQuery` without a template literal (useful for tests/tools). */
export function makeSqlQuery(strings: readonly string[], values: readonly unknown[]): SqlQuery {
  return { [QUERY]: true, strings, values };
}

export const sqlTag: SqlTag = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]): SqlQuery =>
    makeSqlQuery([...strings], values),
  {
    raw: (text: string): Fragment => ({ [FRAGMENT]: true, kind: 'raw', text }),
    id: (...parts: string[]): Fragment => ({ [FRAGMENT]: true, kind: 'identifier', parts }),
    values: (
      rows: Record<string, unknown>[],
      columns?: string[],
      between?: string
    ): Fragment => ({
      [FRAGMENT]: true,
      kind: 'values',
      between,
      rows,
      columns,
    }),
    list: (values: unknown[]): Fragment => ({ [FRAGMENT]: true, kind: 'list', values }),
  }
);
