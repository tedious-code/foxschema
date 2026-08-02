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
 *
 * Code cells: `-- @js` / `-- @ts` / `-- @node` / `-- @nodets` … `-- @end`
 * fences are opaque (inner `;` do not split) and emit a single statement with
 * the matching kind.
 */

export type StatementKind = 'sql' | 'js' | 'ts' | 'node' | 'nodets';

/** Browser-executed fences (`-- @js` / `-- @ts`). Also the wire `kind` for Node cells. */
export type BrowserCodeCellKind = 'js' | 'ts';

/** Server-executed fences (`-- @node` / `-- @nodets`). */
export type NodeCodeCellKind = 'node' | 'nodets';

export type CodeCellKind = BrowserCodeCellKind | NodeCodeCellKind;

/** Fences whose body is TypeScript (transpiled before run). */
export type TsCodeCellKind = Extract<CodeCellKind, 'ts' | 'nodets'>;

export function isCodeCellKind(kind: StatementKind | undefined): kind is CodeCellKind {
  return kind === 'js' || kind === 'ts' || kind === 'node' || kind === 'nodets';
}

/** True when the fence runs on the FoxSchema Node backend. */
export function isNodeCodeCellKind(kind: CodeCellKind | undefined): kind is NodeCodeCellKind {
  return kind === 'node' || kind === 'nodets';
}

/** True when the cell body should be TypeScript-transpiled before run. */
export function codeCellNeedsTs(kind: CodeCellKind | undefined): kind is TsCodeCellKind {
  return kind === 'ts' || kind === 'nodets';
}

/** Map a Node fence kind to the POST /sql/code-cell wire `kind` (`js` | `ts`). */
export function nodeCodeCellWireKind(kind: NodeCodeCellKind): BrowserCodeCellKind {
  return codeCellNeedsTs(kind) ? 'ts' : 'js';
}

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
  /** True when the statement ended with a `;` (SQL) or `-- @end` (code cell). */
  terminated: boolean;
  /** `'sql'` or a fenced code cell — always set by the splitter. */
  kind: StatementKind;
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

// eslint-disable-next-line security/detect-unsafe-regex -- false positive: anchored at ^; optional bounded identifier
const DOLLAR_TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

const FENCE_START_RE =
  /^[ \t]*--[ \t]*@(node-typescript|node-ts|nodets|node|javascript|typescript|js|ts)[ \t]*\r?$/i;
const FENCE_END_RE = /^[ \t]*--[ \t]*@end[ \t]*\r?$/i;

function kindFromFenceTag(tag: string): CodeCellKind {
  const t = tag.toLowerCase();
  if (t === 'nodets' || t === 'node-ts' || t === 'node-typescript') return 'nodets';
  if (t === 'node') return 'node';
  if (t === 'ts' || t === 'typescript') return 'ts';
  return 'js';
}

/** 1-based line number of the character at `index` (0 = start of file). */
function lineAtOffset(sql: string, index: number): number {
  let line = 1;
  const end = Math.min(Math.max(0, index), sql.length);
  for (let i = 0; i < end; i++) {
    if (sql[i] === '\n') line++;
  }
  return line;
}

/** Next line bounds starting at `from` (`end` exclusive of newline; `next` after it). */
function lineBounds(sql: string, from: number): { start: number; end: number; next: number } {
  const len = sql.length;
  const end = sql.indexOf('\n', from);
  if (end < 0) return { start: from, end: len, next: len };
  return { start: from, end, next: end + 1 };
}

export interface CodeFenceRange {
  kind: CodeCellKind;
  start: number;
  end: number;
  closed: boolean;
}

/**
 * Line-oriented scan for `-- @js` / `-- @ts` / `-- @node` / `-- @nodets` …
 * `-- @end` fences. Fences are only recognized when the whole line matches
 * (so SQL string literals containing the text are unlikely to false-positive).
 */
export function findCodeFences(sql: string): CodeFenceRange[] {
  const fences: CodeFenceRange[] = [];
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const { start: lineStart, end: lineEnd, next } = lineBounds(sql, i);
    const startMatch = FENCE_START_RE.exec(sql.slice(lineStart, lineEnd));
    if (!startMatch) {
      i = next;
      continue;
    }

    const kind = kindFromFenceTag(startMatch[1]!);
    let j = next;
    let closed = false;
    let fenceEnd = len;
    while (j < len) {
      const inner = lineBounds(sql, j);
      const line = sql.slice(inner.start, inner.end);
      if (FENCE_END_RE.test(line)) {
        closed = true;
        fenceEnd = inner.next;
        break;
      }
      if (FENCE_START_RE.test(line)) {
        // Nested start without @end — close previous at this line (unterminated).
        fenceEnd = inner.start;
        break;
      }
      j = inner.next;
    }
    fences.push({ kind, start: lineStart, end: fenceEnd, closed });
    i = fenceEnd;
  }
  return fences;
}

/**
 * True when `text` is (or starts as) a fenced JS/TS/Node code cell.
 * Returns kind + body (fence markers stripped; leading `-- @set` may still
 * remain in body — callers typically run parseSetDirectives first).
 */
export function parseCodeCell(
  statement: string
): { kind: CodeCellKind; body: string; closed: boolean } | null {
  const trimmed = statement.replace(/^\s+/, '');
  const nl = trimmed.search(/\r?\n/);
  const firstLine = nl < 0 ? trimmed : trimmed.slice(0, nl);
  const startMatch = FENCE_START_RE.exec(firstLine);
  if (!startMatch) return null;

  const kind = kindFromFenceTag(startMatch[1]!);
  if (nl < 0) return { kind, body: '', closed: false };

  const lines = trimmed.slice(nl).replace(/^\r?\n/, '').split(/\r?\n/);
  // Trailing blank lines after `-- @end` are common; ignore them when closing.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
    lines.pop();
  }
  let closed = false;
  if (lines.length > 0 && FENCE_END_RE.test(lines[lines.length - 1]!)) {
    closed = true;
    lines.pop();
  }
  return { kind, body: lines.join('\n'), closed };
}

/** Strip fence open/close lines from a full cell statement (after @set parse). */
export function stripCodeFenceMarkers(
  statement: string
): { kind: CodeCellKind; body: string } | null {
  const parsed = parseCodeCell(statement);
  return parsed ? { kind: parsed.kind, body: parsed.body } : null;
}

/**
 * Characters after which a `/` starts a regex literal rather than a division.
 * Without this, `split(/\//)` reads as a `//` line comment and swallows the
 * rest of the line — including a trailing `return`.
 */
const REGEX_ALLOWED_AFTER = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<',
  '>', '\n',
]);

/** Skip a regex literal starting at `src[i] === '/'`; returns the index after it. */
function skipRegexLiteral(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return i; // unterminated — treat as division after all
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i + 1;
    i++;
  }
  return i;
}

/** Strip JS line/block comments, regex literals, and quoted strings for keyword scans. */
export function stripJsStringsAndComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  // Last non-whitespace character emitted — decides regex-vs-division below.
  let prev = '';
  while (i < n) {
    const ch = src[i]!;
    const next = src[i + 1] ?? '';
    if (ch === '/' && (prev === '' || REGEX_ALLOWED_AFTER.has(prev)) && next !== '/' && next !== '*') {
      i = skipRegexLiteral(src, i);
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      out += ' ';
      // A string is a value, so a following `/` is division, not a regex.
      prev = 'x';
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return out;
}

/**
 * True when a JS/TS cell body contains a `return` statement (not inside a
 * string/comment). Code cells must return a grid value.
 */
export function codeCellHasReturn(body: string): boolean {
  return /\breturn\b/.test(stripJsStringsAndComments(body));
}

/**
 * Drop full-line SQL `-- …` comments from a code-cell body.
 * Inside JS/TS, `--` is the decrement operator — a line like
 * `-- use last` throws "Invalid left-hand side expression in prefix operation".
 * Prefer `//` comments in cells; this strips accidental SQL-style ones at run time.
 */
export function stripFullLineSqlComments(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !/^[ \t]*--/.test(line))
    .join('\n');
}

/** Split a SQL-only buffer into `;`-terminated statements (no code fences). */
function splitSqlOnly(sql: string): SplitStatement[] {
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
      kind: 'sql',
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

function remapSqlGap(
  gap: string,
  baseOffset: number,
  baseLine: number
): SplitStatement[] {
  return splitSqlOnly(gap).map((s) => ({
    ...s,
    kind: 'sql' as const,
    start: s.start + baseOffset,
    end: s.end + baseOffset,
    startLine: baseLine + s.startLine - 1,
    endLine: baseLine + s.endLine - 1,
  }));
}

/** Split a SQL buffer into `;`-terminated statements, skipping comment-only segments. */
export function splitSqlStatements(sql: string): SplitStatement[] {
  const fences = findCodeFences(sql);
  if (fences.length === 0) return splitSqlOnly(sql);

  const out: SplitStatement[] = [];
  let cursor = 0;
  for (const f of fences) {
    if (f.start > cursor) {
      const gap = sql.slice(cursor, f.start);
      out.push(...remapSqlGap(gap, cursor, lineAtOffset(sql, cursor)));
    }
    // Trim trailing whitespace from fence end for display, keep closed flag.
    let realEnd = f.end;
    while (realEnd > f.start && /\s/.test(sql[realEnd - 1]!)) realEnd--;
    out.push({
      text: sql.slice(f.start, realEnd),
      start: f.start,
      end: realEnd,
      startLine: lineAtOffset(sql, f.start),
      endLine: lineAtOffset(sql, Math.max(f.start, realEnd - 1)),
      terminated: f.closed,
      kind: f.kind,
    });
    cursor = f.end;
  }
  if (cursor < sql.length) {
    out.push(...remapSqlGap(sql.slice(cursor), cursor, lineAtOffset(sql, cursor)));
  }
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
export function checkStatement(
  stmt: Pick<SplitStatement, 'text' | 'terminated'> & { kind?: StatementKind }
): StatementStatus {
  const cell = parseCodeCell(stmt.text);
  const kind = stmt.kind ?? cell?.kind ?? 'sql';
  if (isCodeCellKind(kind)) {
    const reasons: string[] = [];
    if (!stmt.terminated) {
      reasons.push('Missing -- @end for code cell');
    }
    // Strip full-line SQL `--` comments before the return check (`--` is
    // decrement in JS). This covers `-- @set` directives too — they are
    // full-line `--` comments, so no separate pass is needed.
    const body = stripFullLineSqlComments(cell?.body ?? '');
    if (body.trim() && !codeCellHasReturn(body)) {
      reasons.push('Code cell must include a return statement');
    }
    return { level: reasons.length ? 'warn' : 'ok', reasons };
  }

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
 * (`WITH … AS (…) INSERT …`), and data-modifying CTEs whose outer verb is a
 * read (`WITH x AS (DELETE … RETURNING …) SELECT * FROM x`) — PostgreSQL
 * executes the DELETE. Plain `EXPLAIN …` stays non-write (planning only), but
 * `EXPLAIN ANALYZE …` / `EXPLAIN (ANALYZE, …) …` execute the plan on Postgres
 * (and MySQL 8.0.18+), so those inherit the inner statement's write-ness.
 */
export function isWriteStatement(text: string): boolean {
  if (parseCodeCell(text)) return false;
  return sqlTextIsWrite(text);
}

/** Recursive write check used for nested WITH bodies (no code-cell gate). */
function sqlTextIsWrite(text: string): boolean {
  const kw = firstKeyword(text);
  if (!kw) return false;
  if (WRITE_KEYWORDS.has(kw)) return true;
  if (kw === 'explain') {
    const inner = peelExplainAnalyze(text);
    return inner !== null && sqlTextIsWrite(inner);
  }
  if (kw === 'with') {
    for (const body of withCteBodies(text)) {
      if (sqlTextIsWrite(body)) return true;
    }
    const after = keywordAfterWithCtes(text);
    return after !== null && WRITE_KEYWORDS.has(after);
  }
  return false;
}

/** Leading verb after skipping WITH CTEs (lowercased), or null. */
export function statementVerb(text: string): string | null {
  const cell = parseCodeCell(text);
  if (cell) return cell.kind;
  const kw = firstKeyword(text);
  if (!kw) return null;
  if (kw === 'explain') {
    const inner = peelExplainAnalyze(text);
    return inner ? statementVerb(inner) : 'explain';
  }
  if (kw === 'with') return keywordAfterWithCtes(text);
  return kw;
}

const MUTATING_DML = new Set(['update', 'delete', 'merge']);

/**
 * True for UPDATE / DELETE / MERGE (including `WITH … AS (…) UPDATE …` and
 * data-modifying CTEs that return rows via SELECT).
 * Used by SQL Editor safe mode to warn before data-mutating DML.
 */
export function isMutatingDmlStatement(text: string): boolean {
  if (parseCodeCell(text)) return false;
  return sqlTextIsMutatingDml(text);
}

function sqlTextIsMutatingDml(text: string): boolean {
  const kw = firstKeyword(text);
  if (!kw) return false;
  if (kw === 'explain') {
    const inner = peelExplainAnalyze(text);
    return inner !== null && sqlTextIsMutatingDml(inner);
  }
  if (MUTATING_DML.has(kw)) return true;
  if (kw === 'with') {
    for (const body of withCteBodies(text)) {
      if (sqlTextIsMutatingDml(body)) return true;
    }
    const after = keywordAfterWithCtes(text);
    return after !== null && MUTATING_DML.has(after);
  }
  return false;
}

/**
 * If `text` is `EXPLAIN ANALYZE <stmt>` or `EXPLAIN (ANALYZE[, …]) <stmt>`,
 * return the inner statement; otherwise null (plain EXPLAIN is planning-only).
 */
function peelExplainAnalyze(text: string): string | null {
  const lead = firstKeywordSpan(text);
  if (!lead || lead.word !== 'explain') return null;
  const i = skipWsAndComments(text, lead.end);
  if (i >= text.length) return null;

  // EXPLAIN ANALYZE <stmt>
  if (/[A-Za-z_]/.test(text[i]!)) {
    let j = i;
    while (j < text.length && /[A-Za-z_0-9]/.test(text[j]!)) j++;
    if (text.slice(i, j).toLowerCase() !== 'analyze') return null;
    return text.slice(j);
  }

  // EXPLAIN (ANALYZE [, …]) <stmt>
  if (text[i] !== '(') return null;
  const close = text.indexOf(')', i + 1);
  if (close < 0) return null;
  const opts = text.slice(i + 1, close);
  if (!/(^|,)\s*analyze\b/i.test(opts)) return null;
  return text.slice(close + 1);
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
/**
 * Walk leading `WITH [RECURSIVE] name AS (…), …` and return each CTE body
 * (inner text between the AS parentheses). Empty when the lead is not WITH
 * or the CTE list cannot be scanned.
 */
function withCteBodies(text: string): string[] {
  const bodies: string[] = [];
  walkWithCtes(text, (body) => {
    bodies.push(body);
  });
  return bodies;
}

/** Leading verb after the WITH CTE list, or null if unscannable. */
function keywordAfterWithCtes(text: string): string | null {
  const after = walkWithCtes(text);
  return after === null ? null : firstKeyword(after);
}

/**
 * Scan `WITH [RECURSIVE] cte AS (body) [, …]` then return the remainder after
 * the CTE list (main statement text). Invokes `onBody` for each CTE body.
 */
function walkWithCtes(text: string, onBody?: (body: string) => void): string | null {
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
    const close = skipBalancedParens(text, open);
    if (close < 0) return null;
    onBody?.(text.slice(open + 1, close - 1));
    i = close;

    const afterCte = skipWsAndComments(text, i);
    if (afterCte < text.length && text[afterCte] === ',') {
      i = afterCte + 1;
      continue;
    }
    // Main statement follows.
    return text.slice(afterCte);
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
