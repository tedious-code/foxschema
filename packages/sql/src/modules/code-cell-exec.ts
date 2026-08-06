/**
 * Runtime-agnostic SQL Editor code-cell executor.
 *
 * The browser (`-- @js` / `-- @ts`, Web Worker) and the Node backend
 * (`-- @node` / `-- @nodets`, worker_threads) share everything here: the
 * allowlisted-import parser, the return-value normalizer, and the
 * AsyncFunction sandbox. Callers supply only what actually differs between the
 * two runtimes — the bundled module namespaces and the globals preamble.
 */

import {
  codeCellHasReturn,
  stripFullLineSqlComments,
  stripJsStringsAndComments,
} from './sql-splitter.js';
import type {
  CodeCellLast,
  CodeCellOk,
  CodeCellErr,
  CodeCellResult,
  CodeCellVars,
} from './code-cell-types.js';

export const CODE_CELL_ALLOWED_PACKAGES = [
  'lodash',
  'lodash-es',
  'date-fns',
  '@faker-js/faker',
] as const;
export type CodeCellAllowedPackage = (typeof CODE_CELL_ALLOWED_PACKAGES)[number];

const ALLOWED = new Set<string>(CODE_CELL_ALLOWED_PACKAGES);

type NamedBinding = { imported: string; local: string };

export type CodeCellImportSpec =
  | { kind: 'default'; local: string; pkg: string }
  | { kind: 'namespace'; local: string; pkg: string }
  | { kind: 'named'; names: NamedBinding[]; pkg: string };

const DEFAULT_IMPORT_RE = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const NAMESPACE_IMPORT_RE =
  /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const NAMED_IMPORT_RE = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const MIXED_IMPORT_RE = /^import\s+[A-Za-z_$][\w$]*\s*,\s*\{/;

/**
 * Start of an `import` *statement*. The lookahead keeps identifiers that merely
 * begin with "import" (`importantRows = …`) and dynamic `import(…)` out.
 */
const IMPORT_STMT_RE = /^import(?=[\s{*'"])/;

/** Sandbox parameter names an import may not shadow. */
const RESERVED_BINDINGS = new Set(['last', 'vars', 'sql']);

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseNamedList(inner: string): NamedBinding[] | { error: string } {
  const names: NamedBinding[] = [];
  for (const part of inner.split(',')) {
    const bit = part.trim();
    if (!bit) continue;
    const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(bit);
    if (asMatch) {
      names.push({ imported: asMatch[1]!, local: asMatch[2]! });
      continue;
    }
    if (IDENTIFIER_RE.test(bit)) {
      names.push({ imported: bit, local: bit });
      continue;
    }
    return { error: `Invalid named import: ${bit}` };
  }
  return names;
}

function parseImportLine(trimmed: string): CodeCellImportSpec | { error: string } {
  if (MIXED_IMPORT_RE.test(trimmed)) {
    return {
      error: 'Mixed default+named imports are not supported — use separate import lines',
    };
  }

  const ns = NAMESPACE_IMPORT_RE.exec(trimmed);
  if (ns) return { kind: 'namespace', local: ns[1]!, pkg: ns[2]! };

  const named = NAMED_IMPORT_RE.exec(trimmed);
  if (named) {
    const names = parseNamedList(named[1]!);
    if ('error' in names) return names;
    return { kind: 'named', names, pkg: named[2]! };
  }

  const def = DEFAULT_IMPORT_RE.exec(trimmed);
  if (def) return { kind: 'default', local: def[1]!, pkg: def[2]! };

  return { error: `Unsupported import syntax: ${trimmed.slice(0, 80)}` };
}

/**
 * Parse leading `import` lines, validate against the allowlist, and return the
 * remaining body. Imports must be at the top (blank lines / `//` comments ok).
 */
export function parseCodeCellImports(body: string):
  | { ok: true; specs: CodeCellImportSpec[]; bodyWithoutImports: string }
  | { ok: false; error: string } {
  const lines = body.split(/\r?\n/);
  const specs: CodeCellImportSpec[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '' || trimmed.startsWith('//')) {
      i++;
      continue;
    }
    if (!IMPORT_STMT_RE.test(trimmed)) break;

    const parsed = parseImportLine(trimmed);
    if ('error' in parsed) return { ok: false, error: parsed.error };
    if (!ALLOWED.has(parsed.pkg)) {
      return {
        ok: false,
        error: `Package "${parsed.pkg}" is not allowlisted. Allowed: ${[...ALLOWED].join(', ')}`,
      };
    }
    specs.push(parsed);
    i++;
  }

  // Reject mid-body imports (after the first non-import code line). Scan with
  // strings/comments stripped so an `import …` inside a template literal or a
  // commented-out line is not mistaken for real code.
  const rest = stripJsStringsAndComments(lines.slice(i).join('\n'));
  for (const line of rest.split('\n')) {
    if (IMPORT_STMT_RE.test(line.trim())) {
      return {
        ok: false,
        error: 'import statements must appear at the top of the code cell',
      };
    }
  }

  return { ok: true, specs, bodyWithoutImports: lines.slice(i).join('\n').trim() };
}

function moduleDefault(mod: object): unknown {
  if (mod && typeof mod === 'object' && 'default' in mod) {
    const def = (mod as { default: unknown }).default;
    if (def != null) return def;
  }
  return mod;
}

function setBinding(
  bindings: Record<string, unknown>,
  local: string,
  value: unknown
): { error: string } | null {
  if (RESERVED_BINDINGS.has(local)) {
    return {
      error: `"${local}" is reserved for the cell scope — import it under another name (import { ${local} as ${local}Fn } from …)`,
    };
  }
  // `bindings` is a null-prototype object, so hasOwn is the only membership
  // test that matters — `in` / `!== undefined` on a plain object would report
  // inherited keys (`toString`, `valueOf`) as duplicates.
  if (Object.hasOwn(bindings, local)) {
    return { error: `Duplicate binding "${local}"` };
  }
  bindings[local] = value;
  return null;
}

/** Build identifier → value bindings for the sandbox parameters. */
export function resolveCodeCellImportBindings(
  specs: CodeCellImportSpec[],
  modules: Record<string, object>
): { ok: true; bindings: Record<string, unknown> } | { ok: false; error: string } {
  // Null prototype: a local named `toString` / `valueOf` / `__proto__` must be
  // an ordinary key, not a collision with (or a write to) Object.prototype.
  const bindings = Object.create(null) as Record<string, unknown>;

  for (const spec of specs) {
    const mod = modules[spec.pkg];
    if (!mod) return { ok: false, error: `Package "${spec.pkg}" is not loaded` };

    if (spec.kind === 'default') {
      const err = setBinding(bindings, spec.local, moduleDefault(mod));
      if (err) return { ok: false, error: err.error };
      continue;
    }

    if (spec.kind === 'namespace') {
      const err = setBinding(bindings, spec.local, mod);
      if (err) return { ok: false, error: err.error };
      continue;
    }

    const rec = mod as Record<string, unknown>;
    for (const { imported, local } of spec.names) {
      if (!(imported in rec)) {
        return { ok: false, error: `"${imported}" is not exported by "${spec.pkg}"` };
      }
      const err = setBinding(bindings, local, rec[imported]);
      if (err) return { ok: false, error: err.error };
    }
  }

  return { ok: true, bindings };
}

/** Parse + resolve imports in one step. */
export function prepareCodeCellImports(
  body: string,
  modules: Record<string, object>
): { ok: true; body: string; bindings: Record<string, unknown> } | { ok: false; error: string } {
  const parsed = parseCodeCellImports(body);
  if (!parsed.ok) return parsed;
  const resolved = resolveCodeCellImportBindings(parsed.specs, modules);
  if (!resolved.ok) return resolved;
  return { ok: true, body: parsed.bodyWithoutImports, bindings: resolved.bindings };
}

function normalizeObjectRows(value: Record<string, unknown>[], maxRows: number): CodeCellOk {
  const truncated = value.length > maxRows;
  const kept = truncated ? value.slice(0, maxRows) : value;
  // Union the keys of every row that is actually rendered — sampling a fixed
  // prefix silently drops columns that first appear in a later row.
  const colSet = new Set<string>();
  for (const row of kept) {
    for (const k of Object.keys(row)) colSet.add(k);
  }
  const columns = [...colSet];
  const rows = kept.map((r) => columns.map((c) => r[c]));
  return { ok: true, columns, rows, rowCount: rows.length, truncated };
}

function normalizeColumnsRows(
  columnsRaw: unknown[],
  rowsRaw: unknown[],
  maxRows: number
): CodeCellOk {
  const columns = columnsRaw.map((c) => String(c));
  const truncated = rowsRaw.length > maxRows;
  const kept = truncated ? rowsRaw.slice(0, maxRows) : rowsRaw;
  const rows: unknown[][] = kept.map((r) => {
    if (Array.isArray(r)) return columns.map((_, i) => r[i]);
    if (isPlainObject(r)) return columns.map((c) => r[c]);
    return columns.map(() => undefined);
  });
  return { ok: true, columns, rows, rowCount: rows.length, truncated };
}

function isGridScalar(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  );
}

function scalarCell(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeScalarGrid(value: unknown): CodeCellOk {
  return {
    ok: true,
    columns: ['value'],
    rows: [[scalarCell(value)]],
    rowCount: 1,
    truncated: false,
  };
}

/**
 * Normalize a cell return value into columns/rows.
 * Accepts:
 * - `{ columns, rows }` explicit grid
 * - array of plain objects (or mix of objects + scalars)
 * - a single plain object (one row)
 * - a scalar / Date (one cell under `value`)
 */
export function normalizeCodeCellReturn(value: unknown, maxRows: number): CodeCellOk | CodeCellErr {
  if (value === null || value === undefined) {
    return {
      ok: false,
      error:
        'Code cell must return a value — e.g. return [{ … }], return { … }, return 1, or return { columns, rows }',
    };
  }

  if (isGridScalar(value) || value instanceof Date) {
    return normalizeScalarGrid(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { ok: true, columns: [], rows: [], rowCount: 0, truncated: false };
    }
    if (value.every((v) => isPlainObject(v) && !(v instanceof Date))) {
      return normalizeObjectRows(value, maxRows);
    }
    // Scalars / nulls / Dates — and mixed with objects — become grid rows.
    if (
      value.every(
        (v) => v === null || isPlainObject(v) || isGridScalar(v) || v instanceof Date
      )
    ) {
      const asObjects = value.map((v) =>
        isPlainObject(v) && !(v instanceof Date)
          ? v
          : ({ value: scalarCell(v) } as Record<string, unknown>)
      );
      return normalizeObjectRows(asObjects, maxRows);
    }
    return {
      ok: false,
      error:
        'Array return must be objects and/or scalars (or return { columns, rows })',
    };
  }

  if (isPlainObject(value)) {
    const { columns, rows } = value as { columns?: unknown; rows?: unknown };
    // Only treat as an explicit grid when both fields are arrays. A data row
    // like `{ id: 1, email: 'a' }` must not be rejected (and must not be
    // mis-read when it happens to have non-array `columns`/`rows` keys).
    if (Array.isArray(columns) && Array.isArray(rows)) {
      return normalizeColumnsRows(columns, rows, maxRows);
    }
    return normalizeObjectRows([value], maxRows);
  }

  return { ok: false, error: `Unsupported return type: ${typeof value}` };
}

/**
 * Copy the previous grid before handing it to a cell. The worker paths get a
 * structured clone for free, but an in-process run would otherwise pass the
 * caller's own object — a cell doing `last.rows.reverse()` would silently
 * rewrite the result grid already on screen.
 */
export function cloneCodeCellLast(last: CodeCellLast): CodeCellLast {
  if (!last) return last;
  return {
    columns: [...last.columns],
    rows: last.rows.map((r) => [...r]),
    rowCount: last.rowCount,
  };
}

// AsyncFunction so `await` and Promise returns work inside a cell.
const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as FunctionConstructor;

export interface RunCodeCellBodyArgs {
  body: string;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
  /**
   * Runtime globals to shadow inside the cell, e.g. `var process = undefined;`.
   * A guardrail against accidents only — code compiled by the Function
   * constructor runs in global scope and is not affected by this shadowing.
   */
  preamble: string;
  /** Allowlisted package namespaces for this runtime, keyed by import specifier. */
  modules: Record<string, object>;
  /**
   * Extra names to expose in the cell scope (e.g. `sql` for the query bridge).
   * Reserved like `last`/`vars`: an import may not shadow them.
   */
  extraBindings?: Record<string, unknown>;
}

/**
 * Run a code-cell body with `last`, `vars`, and allowlisted import bindings in
 * scope, then normalize whatever it returns into a grid. Callers must
 * transpile TypeScript first.
 */
export async function runCodeCellBody(args: RunCodeCellBodyArgs): Promise<CodeCellResult> {
  // `--` is the decrement operator in JS, so a stray SQL-style comment line
  // would be a syntax error; drop those before anything else looks at the body.
  const rawBody = stripFullLineSqlComments(args.body).trim();
  if (!rawBody) return { ok: false, error: 'Code cell is empty' };

  const prepared = prepareCodeCellImports(rawBody, args.modules);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const body = prepared.body.trim();
  if (!body) return { ok: false, error: 'Code cell is empty after imports' };
  if (!codeCellHasReturn(body)) {
    return {
      ok: false,
      error:
        'Code cell must include a return statement — e.g. return { columns, rows } or return rows.map(...)',
    };
  }

  const bindingNames = Object.keys(prepared.bindings);
  for (const name of bindingNames) {
    if (!IDENTIFIER_RE.test(name)) {
      return { ok: false, error: `Invalid import binding name: ${name}` };
    }
  }
  const bindingValues = bindingNames.map((n) => prepared.bindings[n]);

  const extraNames = Object.keys(args.extraBindings ?? {});
  const extraValues = extraNames.map((n) => args.extraBindings![n]);

  try {
    const fn = new AsyncFunction(
      'last',
      'vars',
      ...extraNames,
      ...bindingNames,
      `${args.preamble}${body}`
    );
    const raw = await fn(
      cloneCodeCellLast(args.last),
      args.vars,
      ...extraValues,
      ...bindingValues
    );
    return normalizeCodeCellReturn(raw, args.maxRows);
  } catch (error: unknown) {
    return { ok: false, error: errorMessage(error) };
  }
}
