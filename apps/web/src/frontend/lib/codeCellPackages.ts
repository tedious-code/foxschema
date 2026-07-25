/**
 * Allowlisted packages for SQL Editor JS/TS code cells.
 * Only these names may appear in `import … from '…'`.
 * Cells stay isolated — imports are resolved per cell (no shared function registry).
 */

import * as lodash from 'lodash-es';
import * as dateFns from 'date-fns';

export const CODE_CELL_ALLOWED_PACKAGES = ['lodash', 'lodash-es', 'date-fns'] as const;
export type CodeCellAllowedPackage = (typeof CODE_CELL_ALLOWED_PACKAGES)[number];

const ALLOWED = new Set<string>(CODE_CELL_ALLOWED_PACKAGES);

/** Bundled module namespaces keyed by import specifier. */
export const CODE_CELL_PACKAGE_MODULES: Record<CodeCellAllowedPackage, object> = {
  lodash: lodash as object,
  'lodash-es': lodash as object,
  'date-fns': dateFns as object,
};

type NamedBinding = { imported: string; local: string };

type ImportSpec =
  | { kind: 'default'; local: string; pkg: string }
  | { kind: 'namespace'; local: string; pkg: string }
  | { kind: 'named'; names: NamedBinding[]; pkg: string };

const DEFAULT_IMPORT_RE =
  /^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const NAMESPACE_IMPORT_RE =
  /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const NAMED_IMPORT_RE =
  /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const MIXED_IMPORT_RE =
  /^import\s+[A-Za-z_$][\w$]*\s*,\s*\{/;

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
    if (/^[A-Za-z_$][\w$]*$/.test(bit)) {
      names.push({ imported: bit, local: bit });
      continue;
    }
    return { error: `Invalid named import: ${bit}` };
  }
  return names;
}

function parseImportLine(trimmed: string): ImportSpec | { error: string } {
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
 * remaining body. Imports must be at the top (blank lines / // comments ok).
 */
export function parseCodeCellImports(body: string):
  | { ok: true; specs: ImportSpec[]; bodyWithoutImports: string }
  | { ok: false; error: string } {
  const lines = body.split(/\r?\n/);
  const specs: ImportSpec[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '' || trimmed.startsWith('//')) {
      i++;
      continue;
    }
    if (!trimmed.startsWith('import')) break;

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

  // Reject mid-body imports (after first non-import code line).
  for (let j = i; j < lines.length; j++) {
    const t = lines[j]!.trim();
    if (t.startsWith('import ') || t.startsWith('import{')) {
      return {
        ok: false,
        error: 'import statements must appear at the top of the code cell',
      };
    }
  }

  return {
    ok: true,
    specs,
    bodyWithoutImports: lines.slice(i).join('\n').trim(),
  };
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
  if (bindings[local] !== undefined) {
    return { error: `Duplicate binding "${local}"` };
  }
  bindings[local] = value;
  return null;
}

/**
 * Build identifier → value bindings for `new Function` parameters.
 */
export function resolveCodeCellImportBindings(
  specs: ImportSpec[],
  modules: Record<string, object> = CODE_CELL_PACKAGE_MODULES
): { ok: true; bindings: Record<string, unknown> } | { ok: false; error: string } {
  const bindings: Record<string, unknown> = {};

  for (const spec of specs) {
    const mod = modules[spec.pkg];
    if (!mod) {
      return { ok: false, error: `Package "${spec.pkg}" is not loaded` };
    }

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
        return {
          ok: false,
          error: `"${imported}" is not exported by "${spec.pkg}"`,
        };
      }
      const err = setBinding(bindings, local, rec[imported]);
      if (err) return { ok: false, error: err.error };
    }
  }

  return { ok: true, bindings };
}

/** Parse + resolve imports in one step. */
export function prepareCodeCellImports(body: string):
  | { ok: true; body: string; bindings: Record<string, unknown> }
  | { ok: false; error: string } {
  const parsed = parseCodeCellImports(body);
  if (!parsed.ok) return parsed;
  const resolved = resolveCodeCellImportBindings(parsed.specs);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    body: parsed.bodyWithoutImports,
    bindings: resolved.bindings,
  };
}
