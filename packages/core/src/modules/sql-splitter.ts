/**
 * Pragmatic SQL statement splitter + per-statement heuristics for the SQL
 * Editor. Browser-safe (pure string logic) — exported via browser.ts so the
 * frontend (gutter indicators, statement strip) and backend (request
 * validation) share one implementation.
 *
 * This is a scanner, NOT a parser. It understands enough lexical structure to
 * split reliably — `--`/`#` line comments, block comments, single/double/
 * backtick/[bracket] quoting (with '' doubling and backslash escapes), and
 * PostgreSQL $tag$…$tag$ dollar quotes — and deliberately nothing more.
 * Known v1 limitation: procedural bodies (CREATE PROCEDURE … BEGIN … END)
 * with internal semicolons split at each `;`; routine DDL belongs in the
 * migration flow, not the editor.
 */

export interface SplitStatement {
  /** Statement text from its first non-whitespace character through its terminator. */
  text: string;
  /** Character offset range in the original string ([start, end)). */
  start: number;
  end: number;
  /** 1-based line of the first code (non-comment) character — where a gutter icon belongs. */
  startLine: number;
  /** 1-based line of the statement's last character. */
  endLine: number;
  /** True when the statement ended with a `;`. */
  terminated: boolean;
}

export interface StatementStatus {
  /** 'ok' = looks complete; 'warn' = incomplete/suspect. A heuristic, not validation. */
  level: 'ok' | 'warn';
  reasons: string[];
}

type Mode = 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'backtick' | 'bracket' | 'dollar';

/** Leading keywords a statement is expected to start with (case-insensitive). */
const KNOWN_KEYWORDS = new Set([
  'select', 'insert', 'update', 'delete', 'with', 'create', 'alter', 'drop', 'truncate',
  'merge', 'grant', 'revoke', 'replace', 'rename', 'explain', 'show', 'describe', 'desc',
  'set', 'use', 'begin', 'commit', 'rollback', 'call', 'exec', 'execute', 'pragma',
  'analyze', 'vacuum', 'values', 'declare', 'comment', 'refresh', 'optimize', 'copy',
]);

/** Leading keywords that modify data or schema — gate these behind a confirmation. */
const WRITE_KEYWORDS = new Set([
  'insert', 'update', 'delete', 'create', 'alter', 'drop', 'truncate', 'merge',
  'grant', 'revoke', 'replace', 'rename',
]);

const DOLLAR_TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Split a SQL buffer into `;`-terminated statements, skipping comment-only segments. */
export function splitSqlStatements(sql: string): SplitStatement[] {
  const out: SplitStatement[] = [];
  const len = sql.length;

  let mode: Mode = 'code';
  let dollarTag = '';
  let line = 1;

  // Statement text starts at the first CODE character — comments between
  // statements act as separators (a leading `-- note` is not part of the
  // statement; a comment after code has started is kept verbatim).
  let codeStart = -1;
  let codeStartLine = 1;

  const reset = () => {
    codeStart = -1;
  };

  const markCode = (idx: number) => {
    if (codeStart < 0) {
      codeStart = idx;
      codeStartLine = line;
    }
  };

  const flush = (endIdx: number, terminated: boolean) => {
    if (codeStart < 0) {
      reset();
      return; // empty or comment-only segment — nothing executable
    }
    // Trim trailing whitespace off the captured range (relevant for the
    // unterminated final statement, which otherwise drags trailing newlines).
    let realEnd = endIdx;
    while (realEnd > codeStart && /\s/.test(sql[realEnd - 1])) realEnd--;
    let endLine = line;
    for (let k = realEnd; k < endIdx; k++) if (sql[k] === '\n') endLine--;
    out.push({
      text: sql.slice(codeStart, realEnd),
      start: codeStart,
      end: realEnd,
      startLine: codeStartLine,
      endLine,
      terminated,
    });
    reset();
  };

  let i = 0;
  while (i < len) {
    const ch = sql[i];
    const next = i + 1 < len ? sql[i + 1] : '';

    switch (mode) {
      case 'code': {
        if (ch === '-' && next === '-') { mode = 'line-comment'; i += 2; continue; }
        if (ch === '#') { mode = 'line-comment'; i += 1; continue; }
        if (ch === '/' && next === '*') { mode = 'block-comment'; i += 2; continue; }
        if (ch === "'") { markCode(i); mode = 'single'; i += 1; continue; }
        if (ch === '"') { markCode(i); mode = 'double'; i += 1; continue; }
        if (ch === '`') { markCode(i); mode = 'backtick'; i += 1; continue; }
        if (ch === '[') { markCode(i); mode = 'bracket'; i += 1; continue; }
        if (ch === '$') {
          const m = DOLLAR_TAG_RE.exec(sql.slice(i, i + 64));
          if (m) { markCode(i); dollarTag = m[0]; mode = 'dollar'; i += m[0].length; continue; }
        }
        if (ch === ';') { markCode(i); flush(i + 1, true); i += 1; continue; }
        if (ch === '\n') { line++; i += 1; continue; }
        if (!/\s/.test(ch)) markCode(i);
        i += 1;
        continue;
      }
      case 'line-comment': {
        if (ch === '\n') { line++; mode = 'code'; }
        i += 1;
        continue;
      }
      case 'block-comment': {
        if (ch === '*' && next === '/') { mode = 'code'; i += 2; continue; }
        if (ch === '\n') line++;
        i += 1;
        continue;
      }
      case 'single':
      case 'double': {
        const q = mode === 'single' ? "'" : '"';
        if (ch === '\\') { i += 2; continue; } // MySQL-style escape; harmless merge risk elsewhere
        if (ch === q) {
          if (next === q) { i += 2; continue; } // '' / "" doubling
          mode = 'code'; i += 1; continue;
        }
        if (ch === '\n') line++;
        i += 1;
        continue;
      }
      case 'backtick': {
        if (ch === '`') {
          if (next === '`') { i += 2; continue; }
          mode = 'code'; i += 1; continue;
        }
        if (ch === '\n') line++;
        i += 1;
        continue;
      }
      case 'bracket': {
        if (ch === ']') {
          if (next === ']') { i += 2; continue; }
          mode = 'code'; i += 1; continue;
        }
        if (ch === '\n') line++;
        i += 1;
        continue;
      }
      case 'dollar': {
        if (sql.startsWith(dollarTag, i)) { i += dollarTag.length; mode = 'code'; continue; }
        if (ch === '\n') line++;
        i += 1;
        continue;
      }
    }
  }
  flush(len, false);
  return out;
}

/** First code word of a statement (lowercased), skipping leading comments/whitespace/parens. */
export function firstKeyword(text: string): string | null {
  let mode: Mode = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (mode === 'code') {
      if (ch === '-' && next === '-') { mode = 'line-comment'; i++; continue; }
      if (ch === '#') { mode = 'line-comment'; continue; }
      if (ch === '/' && next === '*') { mode = 'block-comment'; i++; continue; }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < text.length && /[A-Za-z_0-9]/.test(text[j])) j++;
        return text.slice(i, j).toLowerCase();
      }
      if (ch === '(') continue; // e.g. `(SELECT …) UNION …`
      if (/\s/.test(ch)) continue;
      return null; // starts with something that isn't a word
    } else if (mode === 'line-comment') {
      if (ch === '\n') mode = 'code';
    } else if (mode === 'block-comment') {
      if (ch === '*' && next === '/') { mode = 'code'; i++; }
    }
  }
  return null;
}

/**
 * Cheap completeness signal for the gutter indicator. 'ok' means "looks
 * complete" — balanced quoting/parens, known leading keyword, terminated with
 * a semicolon — NOT that the statement will execute.
 */
export function checkStatement(stmt: Pick<SplitStatement, 'text' | 'terminated'>): StatementStatus {
  const reasons: string[] = [];
  const text = stmt.text;

  // Re-scan the (small) statement text for unclosed constructs + paren balance.
  let mode: Mode = 'code';
  let dollarTag = '';
  let parens = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (mode === 'code') {
      if (ch === '-' && next === '-') { mode = 'line-comment'; i += 2; continue; }
      if (ch === '#') { mode = 'line-comment'; i += 1; continue; }
      if (ch === '/' && next === '*') { mode = 'block-comment'; i += 2; continue; }
      if (ch === "'") { mode = 'single'; i += 1; continue; }
      if (ch === '"') { mode = 'double'; i += 1; continue; }
      if (ch === '`') { mode = 'backtick'; i += 1; continue; }
      if (ch === '[') { mode = 'bracket'; i += 1; continue; }
      if (ch === '$') {
        const m = DOLLAR_TAG_RE.exec(text.slice(i, i + 64));
        if (m) { dollarTag = m[0]; mode = 'dollar'; i += m[0].length; continue; }
      }
      if (ch === '(') parens++;
      if (ch === ')') parens--;
      i += 1;
      continue;
    }
    if (mode === 'line-comment') { if (ch === '\n') mode = 'code'; i += 1; continue; }
    if (mode === 'block-comment') { if (ch === '*' && next === '/') { mode = 'code'; i += 2; continue; } i += 1; continue; }
    if (mode === 'single' || mode === 'double') {
      const q = mode === 'single' ? "'" : '"';
      if (ch === '\\') { i += 2; continue; }
      if (ch === q) { if (next === q) { i += 2; continue; } mode = 'code'; i += 1; continue; }
      i += 1;
      continue;
    }
    if (mode === 'backtick') { if (ch === '`') { if (next === '`') { i += 2; continue; } mode = 'code'; i += 1; continue; } i += 1; continue; }
    if (mode === 'bracket') { if (ch === ']') { if (next === ']') { i += 2; continue; } mode = 'code'; i += 1; continue; } i += 1; continue; }
    if (mode === 'dollar') { if (text.startsWith(dollarTag, i)) { i += dollarTag.length; mode = 'code'; continue; } i += 1; continue; }
  }

  if (mode === 'single' || mode === 'double' || mode === 'backtick' || mode === 'bracket') {
    reasons.push('Unclosed quote');
  } else if (mode === 'block-comment') {
    reasons.push('Unclosed block comment');
  } else if (mode === 'dollar') {
    reasons.push('Unclosed dollar-quoted string');
  }
  if (parens !== 0) reasons.push('Unbalanced parentheses');
  if (!stmt.terminated) reasons.push('Missing terminating semicolon');

  const kw = firstKeyword(text);
  if (!kw) reasons.push('Does not start with a SQL keyword');
  else if (!KNOWN_KEYWORDS.has(kw)) reasons.push(`Unrecognized leading keyword "${kw.toUpperCase()}"`);

  return { level: reasons.length ? 'warn' : 'ok', reasons };
}

/**
 * True when the statement modifies data or schema (confirmation-worthy).
 * Leading WRITE keywords count; so do CTE wrappers whose main verb is a write
 * (`WITH … AS (…) INSERT …`). `EXPLAIN …` stays non-write even when it wraps a
 * mutating verb — EXPLAIN does not apply the change.
 */
export function isWriteStatement(text: string): boolean {
  const kw = firstKeyword(text);
  if (!kw) return false;
  if (WRITE_KEYWORDS.has(kw)) return true;
  if (kw === 'explain') return false;
  if (kw === 'with') {
    const after = keywordAfterWithCtes(text);
    return after !== null && WRITE_KEYWORDS.has(after);
  }
  return false;
}

/** Leading verb after skipping WITH CTEs (lowercased), or null. */
export function statementVerb(text: string): string | null {
  const kw = firstKeyword(text);
  if (!kw) return null;
  if (kw === 'explain') return 'explain';
  if (kw === 'with') return keywordAfterWithCtes(text);
  return kw;
}

const MUTATING_DML = new Set(['update', 'delete', 'merge']);

/**
 * True for UPDATE / DELETE / MERGE (including `WITH … AS (…) UPDATE …`).
 * Used by SQL Editor safe mode to warn before data-mutating DML.
 */
export function isMutatingDmlStatement(text: string): boolean {
  const verb = statementVerb(text);
  return verb !== null && MUTATING_DML.has(verb);
}

/**
 * Heuristic: UPDATE/DELETE with no WHERE clause (full-table mutation risk).
 * Ignores WHERE inside strings/comments only loosely — strips simple quotes.
 * MERGE is excluded (matched via ON, not WHERE).
 */
export function dmlLacksWhere(text: string): boolean {
  const verb = statementVerb(text);
  if (verb !== 'update' && verb !== 'delete') return false;
  // Drop quoted literals so a string containing "where" does not count.
  const stripped = text
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ');
  return !/\bwhere\b/i.test(stripped);
}

/**
 * Map lowercased alias (and bare table name) → table identifier as written.
 * Heuristic regex over `FROM|JOIN|UPDATE|INTO <ident> [AS] <alias>` — not a full
 * parser. Alias candidates that match a SQL keyword blacklist are ignored
 * (so `FROM t WHERE` does not treat WHERE as an alias).
 */
export function extractTableAliases(sql: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!sql) return out;

  // Quoted ("…"/`…`/[…]) or dotted bare identifiers.
  const ident =
    '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*(?:\\.[A-Za-z_][\\w$]*)*)';
  // FROM/JOIN/UPDATE/INTO <table> [AS] <alias>
  // Plus comma-separated FROM items that include an alias (`FROM a x, b y`) —
  // alias is required after `,` so `SELECT a, b FROM t` is not mistaken for tables.
  const re = new RegExp(
    `\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(${ident})(?:\\s+(?:AS\\s+)?(${ident}))?|,\\s+(${ident})\\s+(?:AS\\s+)?(${ident})`,
    'gi'
  );

  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const tableRaw = m[1] ?? m[3];
    const aliasRaw = m[2] ?? m[4];
    if (!tableRaw) continue;
    const table = stripIdentQuotes(tableRaw);
    if (!table) continue;
    const tableKey = table.toLowerCase();
    // Do NOT blacklist the table name — real tables are often keywords
    // (ORDER, USER, GROUP, …). Only aliases are filtered below.

    const bare = tableKey.includes('.') ? tableKey.slice(tableKey.lastIndexOf('.') + 1) : tableKey;
    out[tableKey] = table;
    out[bare] = table;

    if (!aliasRaw) continue;
    const alias = stripIdentQuotes(aliasRaw);
    if (!alias) continue;
    if (ALIAS_KEYWORD_BLACKLIST.has(alias.toLowerCase())) continue;
    out[alias.toLowerCase()] = table;
  }
  return out;
}

/** Keywords that must never be treated as a table alias. */
const ALIAS_KEYWORD_BLACKLIST = new Set([
  'where', 'on', 'set', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross',
  'group', 'order', 'limit', 'offset', 'using', 'and', 'or', 'as', 'by', 'into',
  'values', 'select', 'from', 'update', 'insert', 'delete', 'having', 'union',
  'except', 'intersect', 'returning', 'with', 'natural', 'lateral',
]);

function stripIdentQuotes(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) {
      return s.slice(1, -1).replace(/""/g, '"').replace(/``/g, '`');
    }
    if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).replace(/\]\]/g, ']');
  }
  return s;
}

/**
 * After a leading `WITH [RECURSIVE] cte AS (…) [, …]`, return the main-verb
 * keyword (SELECT / INSERT / …). Returns null when the CTE list cannot be
 * walked (malformed or still open).
 */
function keywordAfterWithCtes(text: string): string | null {
  let i = 0;
  // Skip to the end of the leading WITH keyword.
  const lead = firstKeywordSpan(text);
  if (!lead || lead.word !== 'with') return null;
  i = lead.end;

  // Optional RECURSIVE.
  const rec = nextWord(text, i);
  if (rec && rec.word === 'recursive') i = rec.end;

  // Walk `name [(cols)] AS (…)` [, …]
  while (i < text.length) {
    const name = nextWord(text, i);
    if (!name) return null;
    i = name.end;

    // Optional column list.
    const afterName = skipWsAndComments(text, i);
    if (afterName < text.length && text[afterName] === '(') {
      i = skipBalancedParens(text, afterName);
      if (i < 0) return null;
    }

    const asKw = nextWord(text, i);
    if (!asKw || asKw.word !== 'as') return null;
    i = asKw.end;

    const open = skipWsAndComments(text, i);
    if (open >= text.length || text[open] !== '(') return null;
    i = skipBalancedParens(text, open);
    if (i < 0) return null;

    const afterCte = skipWsAndComments(text, i);
    if (afterCte < text.length && text[afterCte] === ',') {
      i = afterCte + 1;
      continue;
    }
    // Main verb follows.
    return firstKeyword(text.slice(afterCte));
  }
  return null;
}

function firstKeywordSpan(text: string): { word: string; end: number } | null {
  let mode: Mode = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (mode === 'code') {
      if (ch === '-' && next === '-') { mode = 'line-comment'; i++; continue; }
      if (ch === '#') { mode = 'line-comment'; continue; }
      if (ch === '/' && next === '*') { mode = 'block-comment'; i++; continue; }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < text.length && /[A-Za-z_0-9]/.test(text[j])) j++;
        return { word: text.slice(i, j).toLowerCase(), end: j };
      }
      if (ch === '(' || /\s/.test(ch)) continue;
      return null;
    } else if (mode === 'line-comment') {
      if (ch === '\n') mode = 'code';
    } else if (mode === 'block-comment') {
      if (ch === '*' && next === '/') { mode = 'code'; i++; }
    }
  }
  return null;
}

function skipWsAndComments(text: string, from: number): number {
  let mode: Mode = 'code';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (mode === 'code') {
      if (ch === '-' && next === '-') { mode = 'line-comment'; i++; continue; }
      if (ch === '#') { mode = 'line-comment'; continue; }
      if (ch === '/' && next === '*') { mode = 'block-comment'; i++; continue; }
      if (/\s/.test(ch)) continue;
      return i;
    } else if (mode === 'line-comment') {
      if (ch === '\n') mode = 'code';
    } else if (mode === 'block-comment') {
      if (ch === '*' && next === '/') { mode = 'code'; i++; }
    }
  }
  return text.length;
}

function nextWord(text: string, from: number): { word: string; end: number } | null {
  const i = skipWsAndComments(text, from);
  if (i >= text.length || !/[A-Za-z_]/.test(text[i])) return null;
  let j = i;
  while (j < text.length && /[A-Za-z_0-9]/.test(text[j])) j++;
  return { word: text.slice(i, j).toLowerCase(), end: j };
}

/** Advance past a `(…)` group starting at `open` (must be '('). Returns index after `)` or -1. */
function skipBalancedParens(text: string, open: number): number {
  let depth = 0;
  let mode: Mode = 'code';
  let dollarTag = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (mode === 'code') {
      if (ch === '-' && next === '-') { mode = 'line-comment'; i++; continue; }
      if (ch === '#') { mode = 'line-comment'; continue; }
      if (ch === '/' && next === '*') { mode = 'block-comment'; i++; continue; }
      if (ch === "'") { mode = 'single'; continue; }
      if (ch === '"') { mode = 'double'; continue; }
      if (ch === '`') { mode = 'backtick'; continue; }
      if (ch === '[') { mode = 'bracket'; continue; }
      if (ch === '$') {
        const m = DOLLAR_TAG_RE.exec(text.slice(i, i + 64));
        if (m) { dollarTag = m[0]; mode = 'dollar'; i += m[0].length - 1; continue; }
      }
      if (ch === '(') { depth++; continue; }
      if (ch === ')') {
        depth--;
        if (depth === 0) return i + 1;
        continue;
      }
      continue;
    }
    if (mode === 'line-comment') { if (ch === '\n') mode = 'code'; continue; }
    if (mode === 'block-comment') { if (ch === '*' && next === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'single' || mode === 'double') {
      const q = mode === 'single' ? "'" : '"';
      if (ch === '\\') { i++; continue; }
      if (ch === q) { if (next === q) { i++; continue; } mode = 'code'; }
      continue;
    }
    if (mode === 'backtick') { if (ch === '`') { if (next === '`') { i++; continue; } mode = 'code'; } continue; }
    if (mode === 'bracket') { if (ch === ']') { if (next === ']') { i++; continue; } mode = 'code'; } continue; }
    if (mode === 'dollar') { if (text.startsWith(dollarTag, i)) { i += dollarTag.length - 1; mode = 'code'; } continue; }
  }
  return -1;
}
