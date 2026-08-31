/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sorting and filtering a result grid on the rows already loaded.
 *
 * Deliberately client-side: it reorders and hides rows *on this page*, which is
 * instant and needs no database round trip. That is the right answer while
 * scanning a page and the wrong one for finding a row that is not on it, so the
 * grid labels the result "this page only". A filter that silently searches the
 * loaded rows while looking like it searched the table is a filter that lies.
 *
 * Nothing here builds SQL. Pushing the same sort and filters into the query is
 * a separate job — it needs each value bound or dialect-correctly quoted — and
 * is not part of this module.
 */

export type SortDirection = 'asc' | 'desc';

export interface GridSort {
  /** Index into the result's `columns`. */
  column: number;
  direction: SortDirection;
}

/** The comparisons a column filter can make. */
export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'isNull'
  | 'isNotNull';

export interface GridFilter {
  column: number;
  operator: FilterOperator;
  /** Ignored by `isNull` / `isNotNull`. */
  value?: string;
}

/** Operators that ask about presence, so an empty value is meaningful. */
export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== 'isNull' && op !== 'isNotNull';
}

/**
 * Compare two cells for sorting.
 *
 * Numbers compare numerically even when the driver handed them back as strings
 * — `pg` returns NUMERIC as a string, so a lexicographic sort would put 10
 * before 9 in a column of prices. Dates are left to string comparison, which is
 * correct for the ISO-8601 the drivers emit and avoids parsing every cell twice.
 *
 * NULL sorts last in both directions. It is the absence of a value, and pinning
 * it to one end keeps it out of the way of whatever the user is actually
 * looking at; flipping it with the direction would hide it at the top half the
 * time.
 */
export function compareCells(a: unknown, b: unknown, direction: SortDirection): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const sign = direction === 'asc' ? 1 : -1;

  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  const bothNumeric =
    Number.isFinite(an) && Number.isFinite(bn) && String(a).trim() !== '' && String(b).trim() !== '';
  if (bothNumeric) return an === bn ? 0 : (an < bn ? -1 : 1) * sign;

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : (a ? 1 : -1) * sign;
  }

  const as = String(a);
  const bs = String(b);
  // `localeCompare` so accented text sorts where a reader expects, and
  // `numeric` so `item2` precedes `item10` in a mixed identifier column.
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' }) * sign;
}

/** Does one cell satisfy one filter? */
export function cellMatches(value: unknown, filter: GridFilter): boolean {
  const isNull = value === null || value === undefined;
  if (filter.operator === 'isNull') return isNull;
  if (filter.operator === 'isNotNull') return !isNull;
  // Every other operator asks about content, which a NULL does not have.
  if (isNull) return false;

  const needle = filter.value ?? '';
  const hay = String(value);

  switch (filter.operator) {
    case 'contains':
      return hay.toLowerCase().includes(needle.toLowerCase());
    case 'startsWith':
      return hay.toLowerCase().startsWith(needle.toLowerCase());
    case 'endsWith':
      return hay.toLowerCase().endsWith(needle.toLowerCase());
    case 'equals':
      return hay.toLowerCase() === needle.toLowerCase();
    case 'notEquals':
      return hay.toLowerCase() !== needle.toLowerCase();
    default:
      break;
  }

  // Ordering comparisons: numeric when both sides are numbers, else textual,
  // so a date or a name column still answers `>` sensibly.
  //
  // Both sides must be non-blank before taking the numeric path. `Number('')`
  // and `Number('   ')` are 0, so a blank cell would answer `> -1` as true and
  // sort itself in among the numbers — the same trap `compareCells` guards
  // against, and it has to be guarded in both or the filter and the sort
  // disagree about what a blank is.
  const a = Number(hay);
  const b = Number(needle);
  const numeric =
    Number.isFinite(a) && Number.isFinite(b) && hay.trim() !== '' && needle.trim() !== '';
  const cmp = numeric ? (a === b ? 0 : a < b ? -1 : 1) : hay.localeCompare(needle, undefined, { numeric: true });

  switch (filter.operator) {
    case 'gt':
      return cmp > 0;
    case 'gte':
      return cmp >= 0;
    case 'lt':
      return cmp < 0;
    case 'lte':
      return cmp <= 0;
    default:
      return true;
  }
}

export interface GridViewState {
  sort: GridSort | null;
  /** At most one filter per column, keyed by column index. */
  filters: readonly GridFilter[];
}

export const EMPTY_VIEW: GridViewState = { sort: null, filters: [] };

export function viewIsActive(view: GridViewState): boolean {
  return view.sort !== null || view.filters.length > 0;
}

/**
 * Apply a view to loaded rows.
 *
 * Returns the row indices, not the rows: the grid keeps selection, row numbers
 * and CRUD keyed to a row's position in the *source*, and handing back
 * reordered copies would quietly break the link between a selected cell and the
 * record it edits.
 *
 * The sort is stable — `Array.prototype.sort` is required to be since ES2019 —
 * so rows that tie keep the order the database returned them in.
 */
export function applyGridView(
  rows: readonly (readonly unknown[])[],
  view: GridViewState
): number[] {
  const active = view.filters.filter((f) => !operatorNeedsValue(f.operator) || (f.value ?? '') !== '');

  let indices = rows.map((_, i) => i);
  if (active.length > 0) {
    indices = indices.filter((i) => active.every((f) => cellMatches(rows[i]?.[f.column], f)));
  }
  if (view.sort) {
    const { column, direction } = view.sort;
    indices = [...indices].sort((x, y) =>
      compareCells(rows[x]?.[column], rows[y]?.[column], direction)
    );
  }
  return indices;
}

/** The next direction when a header is clicked: asc → desc → off. */
export function nextSort(current: GridSort | null, column: number): GridSort | null {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return null;
}

/**
 * A short description of the active view, for the toolbar's tooltip.
 *
 * Says what is being hidden and how it is ordered, so the scope badge can be
 * terse without the user having to guess what it refers to.
 */
export function describeGridView(columns: readonly string[], view: GridViewState): string {
  const parts: string[] = [];
  const usable = view.filters.filter(
    (f) => !operatorNeedsValue(f.operator) || (f.value ?? '') !== ''
  );
  for (const f of usable) {
    const name = columns[f.column] ?? `column ${f.column + 1}`;
    parts.push(
      operatorNeedsValue(f.operator) ? `${name} ${f.operator} "${f.value}"` : `${name} ${f.operator}`
    );
  }
  if (view.sort) {
    const name = columns[view.sort.column] ?? `column ${view.sort.column + 1}`;
    parts.push(`sorted by ${name} ${view.sort.direction}`);
  }
  return parts.join(', ');
}
