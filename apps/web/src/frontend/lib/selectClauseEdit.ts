/**
 * Helpers to inject columns into a SELECT list (Schema click / column picker).
 */
import { extractTableAliases } from './sql-splitter';

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

/** Split a SELECT list on top-level commas (ignore commas inside () / quotes). */
export function parseSelectListItems(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!;
    const prev = i > 0 ? list[i - 1]! : '';
    if (inSingle) {
      if (ch === "'" && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      const part = list.slice(start, i).trim();
      if (part) items.push(part);
      start = i + 1;
    }
  }
  const last = list.slice(start).trim();
  if (last) items.push(last);
  return items;
}

function replaceSelectList(sql: string, nextListInner: string): string {
  const range = findSelectListRange(sql);
  if (!range) {
    return `SELECT ${nextListInner.trim() || '*'}\nFROM `;
  }
  const inner = nextListInner.trim();
  const nextList = inner ? ` ${inner} ` : ' ';
  return sql.slice(0, range.listStart) + nextList + sql.slice(range.listEnd);
}

/**
 * Insert `columnExpr` into the SELECT list (before FROM). Replaces a lone `*`
 * when that is the only item; otherwise appends with a comma.
 */
export function insertIntoSelectList(sql: string, columnExpr: string): string {
  const range = findSelectListRange(sql);
  if (!range) {
    return `SELECT ${columnExpr}\nFROM `;
  }
  const list = sql.slice(range.listStart, range.listEnd).trim();
  let nextList: string;
  if (!list || list === '*') {
    nextList = ` ${columnExpr} `;
  } else {
    const items = parseSelectListItems(list);
    if (items.some((it) => it.toLowerCase() === columnExpr.toLowerCase())) {
      return sql; // already present
    }
    const needsComma = !/,\s*$/.test(list);
    nextList = ` ${list}${needsComma ? ',' : ''} ${columnExpr} `;
  }
  return sql.slice(0, range.listStart) + nextList + sql.slice(range.listEnd);
}

/** Replace the SELECT list with `*`. */
export function setSelectListToStar(sql: string): string {
  return replaceSelectList(sql, '*');
}

/** Clear every SELECT item (leaves `SELECT  FROM …`). */
export function clearSelectList(sql: string): string {
  return replaceSelectList(sql, '');
}

/** Remove one expression from the SELECT list (case-insensitive match). */
export function removeFromSelectList(sql: string, columnExpr: string): string {
  const range = findSelectListRange(sql);
  if (!range) return sql;
  const list = sql.slice(range.listStart, range.listEnd).trim();
  if (!list) return sql;
  if (list === '*') return sql;
  const target = columnExpr.toLowerCase();
  const next = parseSelectListItems(list).filter((it) => it.toLowerCase() !== target);
  if (next.length === parseSelectListItems(list).length) return sql;
  return replaceSelectList(sql, next.join(', '));
}

/** True when the SELECT list is exactly `*`. */
export function selectListIsStar(sql: string): boolean {
  const range = findSelectListRange(sql);
  if (!range) return false;
  return sql.slice(range.listStart, range.listEnd).trim() === '*';
}

/** Normalized SELECT items currently in the first SELECT list. */
export function currentSelectListItems(sql: string): string[] {
  const range = findSelectListRange(sql);
  if (!range) return [];
  const list = sql.slice(range.listStart, range.listEnd).trim();
  if (!list || list === '*') return list === '*' ? ['*'] : [];
  return parseSelectListItems(list);
}

/** Keywords that must never be used as a generated table alias. */
const ALIAS_BLACKLIST = new Set([
  'select',
  'from',
  'where',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'on',
  'and',
  'or',
  'group',
  'order',
  'by',
  'having',
  'limit',
  'offset',
  'union',
  'except',
  'intersect',
  'as',
  'with',
  'into',
  'set',
  'update',
  'delete',
  'insert',
  'values',
  'table',
  'view',
]);

/**
 * Suggest a short alias for `tableName` that does not collide with existing
 * aliases/tables in `sql` (or an optional precomputed set).
 */
export function suggestTableAlias(tableName: string, sqlOrTaken: string | Set<string>): string {
  const bare = tableName.includes('.')
    ? tableName.slice(tableName.lastIndexOf('.') + 1)
    : tableName;
  const cleaned = bare.replace(/[^A-Za-z0-9_]/g, '');
  const parts = cleaned.split(/_+/).filter(Boolean);
  let base =
    parts.length >= 2
      ? parts.map((p) => p[0]!.toLowerCase()).join('')
      : cleaned.slice(0, 1).toLowerCase();
  if (!base || !/^[a-z]/.test(base)) base = 't';
  if (ALIAS_BLACKLIST.has(base)) base = `${base}t`;

  const taken =
    typeof sqlOrTaken === 'string'
      ? new Set(Object.keys(extractTableAliases(sqlOrTaken)))
      : sqlOrTaken;

  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36).slice(-3)}`;
}

/** Short alias already assigned to this table in `sql`, if any. */
export function existingShortAliasForTable(sql: string, tableIdent: string): string | null {
  const bare = tableIdent.includes('.')
    ? tableIdent.slice(tableIdent.lastIndexOf('.') + 1)
    : tableIdent;
  const bareKey = bare.toLowerCase();
  const fullKey = tableIdent.toLowerCase();
  for (const [alias, table] of Object.entries(extractTableAliases(sql))) {
    const t = table.toLowerCase();
    if (t !== bareKey && t !== fullKey && !t.endsWith(`.${bareKey}`)) continue;
    // Skip the synthetic keys extractTableAliases always adds for the table name itself.
    if (alias === t || alias === bareKey || alias === fullKey) continue;
    return alias;
  }
  return null;
}

/**
 * Ensure `tableIdent alias` appears in the FROM clause. Creates
 * `SELECT * FROM table alias` when needed. Skips if the table already has a
 * short alias in the query.
 */
export function addTableWithAliasToFrom(
  sql: string,
  tableIdent: string,
  alias?: string
): { sql: string; alias: string; added: boolean } {
  const bare = tableIdent.includes('.')
    ? tableIdent.slice(tableIdent.lastIndexOf('.') + 1)
    : tableIdent;
  const existing = existingShortAliasForTable(sql, tableIdent);
  if (existing) return { sql, alias: existing, added: false };

  const nextAlias = alias || suggestTableAlias(bare, sql);
  const fragment = `${tableIdent} ${nextAlias}`;
  const trimmed = sql.trim();
  if (!trimmed) {
    return { sql: `SELECT *\nFROM ${fragment}`, alias: nextAlias, added: true };
  }

  const range = findSelectListRange(sql);
  if (!range) {
    return {
      sql: `SELECT *\nFROM ${fragment}\n\n${sql}`,
      alias: nextAlias,
      added: true,
    };
  }

  // Find end of FROM clause item list (before WHERE/GROUP/ORDER/…).
  const afterFromKw = range.fromStart + 4; // "FROM"
  const rest = sql.slice(afterFromKw);
  const stop =
    /\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|EXCEPT|INTERSECT|FOR\s+UPDATE|;)\b/i.exec(
      rest
    );
  const fromClauseEnd = stop ? afterFromKw + stop.index : sql.length;
  const fromBody = sql.slice(afterFromKw, fromClauseEnd).trim();

  // Table already in FROM without a short alias — reuse bare name, don't duplicate.
  const aliases = extractTableAliases(sql);
  if (aliases[bare.toLowerCase()] || aliases[tableIdent.toLowerCase()]) {
    return { sql, alias: bare, added: false };
  }

  const joiner = fromBody ? ', ' : ' ';
  const nextSql =
    sql.slice(0, fromClauseEnd).replace(/\s*$/, '') +
    `${joiner}${fragment}` +
    sql.slice(fromClauseEnd);
  return { sql: nextSql, alias: nextAlias, added: true };
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
