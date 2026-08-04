/**
 * Helpers to inject columns into a SELECT list (Schema click / column picker).
 */

/** Find the SELECT … FROM span for the first SELECT in `sql` (heuristic). */
export function findSelectListRange(
  sql: string
): { selectKeywordStart: number; listStart: number; listEnd: number; fromStart: number } | null {
  const re = /\bselect\b/i;
  const m = re.exec(sql);
  if (!m) return null;
  const selectKeywordStart = m.index;
  const afterSelect = selectKeywordStart + m[0].length;
  // Skip DISTINCT / ALL / TOP n
  let i = afterSelect;
  const head = sql.slice(i);
  const skip = /^\s+(?:distinct|all)\b/i.exec(head);
  if (skip) i += skip[0].length;
  // Two passes, not `\d+(\s+percent)?\b`: a `+` nested inside an optional group
  // is the star-height-2 shape `security/detect-unsafe-regex` rejects, and this
  // runs on every keystroke against editor text.
  const top = /^\s+top\s+\d+\b/i.exec(sql.slice(i));
  if (top) {
    i += top[0].length;
    const percent = /^\s+percent\b/i.exec(sql.slice(i));
    if (percent) i += percent[0].length;
  }
  const listStart = i;
  const fromRe = /\bfrom\b/i;
  const fromMatch = fromRe.exec(sql.slice(listStart));
  if (!fromMatch) return null;
  const fromStart = listStart + fromMatch.index;
  return { selectKeywordStart, listStart, listEnd: fromStart, fromStart };
}

/**
 * Insert `columnExpr` into the SELECT list (before FROM). Replaces a lone `*`
 * when that is the only item; otherwise appends with a comma.
 */
export function insertIntoSelectList(sql: string, columnExpr: string): string {
  const range = findSelectListRange(sql);
  if (!range) {
    // No SELECT — prepend a starter query.
    return `SELECT ${columnExpr}\nFROM `;
  }
  const list = sql.slice(range.listStart, range.listEnd).trim();
  let nextList: string;
  if (!list || list === '*') {
    nextList = ` ${columnExpr} `;
  } else {
    const needsComma = !/,\s*$/.test(list);
    nextList = ` ${list}${needsComma ? ',' : ''} ${columnExpr} `;
  }
  return sql.slice(0, range.listStart) + nextList + sql.slice(range.listEnd);
}

/** True when the word at offset is SELECT or FROM (case-insensitive). */
export function isSelectOrFromKeyword(sql: string, offset: number): 'select' | 'from' | null {
  if (offset < 0 || offset > sql.length) return null;
  // Expand to word bounds
  let start = offset;
  let end = offset;
  while (start > 0 && /[A-Za-z_]/.test(sql[start - 1]!)) start -= 1;
  while (end < sql.length && /[A-Za-z_]/.test(sql[end]!)) end += 1;
  const word = sql.slice(start, end).toLowerCase();
  if (word === 'select' || word === 'from') return word;
  return null;
}
