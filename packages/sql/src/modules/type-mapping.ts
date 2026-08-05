import type { CanonicalBase, CanonicalType, RenderedType, SqlDialect } from './sql-dialect.interface';

/**
 * Cross-dialect type translation. Each provider supplies two small lookup tables
 * (native name → canonical base, and canonical base → native syntax); the shared
 * tokenizer and factory here do the parsing/rendering so no provider repeats it.
 *
 * Browser-safe: pure string logic, no Node built-ins.
 */

/** A native type string broken into its name and size arguments. */
export interface TypeToken {
  /** Lowercased, whitespace-collapsed type name with parenthetical args removed. */
  name: string;
  length?: number; // single arg, e.g. VARCHAR(255)
  precision?: number; // first of two args, e.g. DECIMAL(10,2)
  scale?: number; // second of two args
  /** true when the size was given as (max) — SQL Server. */
  lengthIsMax?: boolean;
}

/**
 * Split a native type string into name + size args, wherever the parens sit:
 *   "VARCHAR(255)"                  → { name: 'varchar', length: 255 }
 *   "DECIMAL(10,2)"                 → { name: 'decimal', precision: 10, scale: 2 }
 *   "timestamp(6) without time zone"→ { name: 'timestamp without time zone', length: 6 }
 *   "nvarchar(max)"                 → { name: 'nvarchar', lengthIsMax: true }
 */
export function tokenizeType(raw: string): TypeToken {
  const trimmed = (raw ?? '').trim();
  const paren = trimmed.match(/\(([^)]*)\)/);
  const name = trimmed
    .replace(/\([^)]*\)/, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const tok: TypeToken = { name };
  if (paren) {
    const args = paren[1].split(',').map((a) => a.trim());
    if (args.length === 1) {
      if (/^max$/i.test(args[0])) tok.lengthIsMax = true;
      else if (args[0] && !Number.isNaN(Number(args[0]))) tok.length = Number(args[0]);
    } else if (args.length >= 2) {
      if (!Number.isNaN(Number(args[0]))) tok.precision = Number(args[0]);
      if (!Number.isNaN(Number(args[1]))) tok.scale = Number(args[1]);
    }
  }
  return tok;
}

/** A parse rule is either a fixed base or a resolver that inspects the token (e.g. tinyint(1) → boolean). */
export type ParseRule = CanonicalBase | ((tok: TypeToken) => CanonicalBase);
/** A render rule produces native syntax; may attach a warning for inexact mappings. */
export type RenderRule = (t: CanonicalType) => string | RenderedType;

export interface DialectTypeConfig {
  /** Human label for warning messages, e.g. 'PostgreSQL'. */
  label: string;
  parseMap: Record<string, ParseRule>;
  renderMap: Partial<Record<CanonicalBase, RenderRule>>;
  /** Optional name massaging before lookup (e.g. strip MySQL 'unsigned'). */
  normalizeName?: (name: string) => string;
}

/** Keep only the size fields that are meaningful for the resolved base. */
function shapeCanonical(base: CanonicalBase, tok: TypeToken, raw: string): CanonicalType {
  const t: CanonicalType = { base, raw: raw.trim() };
  if (base === 'char' || base === 'varchar' || base === 'binary' || base === 'varbinary') {
    if (tok.length !== undefined) t.length = tok.length;
  } else if (base === 'decimal') {
    if (tok.precision !== undefined) t.precision = tok.precision;
    if (tok.scale !== undefined) t.scale = tok.scale;
  }
  return t;
}

/** Build a dialect's `parseType`/`renderType` from its lookup tables. */
export function makeDialectTypeFns(cfg: DialectTypeConfig): Pick<SqlDialect, 'parseType' | 'renderType'> {
  return {
    parseType(raw: string): CanonicalType {
      const tok = tokenizeType(raw);
      const key = cfg.normalizeName ? cfg.normalizeName(tok.name) : tok.name;
      const rule = cfg.parseMap[key];
      const base: CanonicalBase = typeof rule === 'function' ? rule(tok) : rule ?? 'unknown';
      return shapeCanonical(base, tok, raw);
    },
    renderType(t: CanonicalType): RenderedType {
      const rule = cfg.renderMap[t.base];
      if (!rule) {
        return { sql: t.raw, warning: `No ${cfg.label} equivalent for "${t.raw}"; left as-is` };
      }
      const out = rule(t);
      return typeof out === 'string' ? { sql: out } : out;
    },
  };
}

// ── render-rule builders (keep per-dialect tables terse) ──────────────────────

/** Always renders the same keyword. */
export const plain = (kw: string): RenderRule => () => kw;

/** Renders `kw(length)` when a length is present, else bare `kw`. */
export const sized = (kw: string): RenderRule => (t) => (t.length ? `${kw}(${t.length})` : kw);

/** Renders `kw(length)`, falling back to a fixed string (with optional warning) when unsized. */
export const sizedOr = (kw: string, fallbackSql: string, fallbackWarn?: string): RenderRule => (t) =>
  t.length ? `${kw}(${t.length})` : fallbackWarn ? { sql: fallbackSql, warning: fallbackWarn } : fallbackSql;

/** Renders `kw(precision[,scale])` when a precision is present, else bare `kw`. */
export const decimalAs = (kw: string): RenderRule => (t) =>
  t.precision !== undefined ? `${kw}(${t.precision}${t.scale !== undefined ? `,${t.scale}` : ''})` : kw;

/** Always renders `sql`, attaching a warning (for known inexact mappings). */
export const warn = (sql: string, message: string): RenderRule => () => ({ sql, warning: message });

/** True when two canonical types are equivalent (base + relevant size fields). */
export function canonicalEquals(a: CanonicalType, b: CanonicalType): boolean {
  if (a.base !== b.base) return false;
  switch (a.base) {
    case 'char':
    case 'varchar':
    case 'binary':
    case 'varbinary':
      return (a.length ?? null) === (b.length ?? null);
    case 'decimal':
      return (a.precision ?? null) === (b.precision ?? null) && (a.scale ?? null) === (b.scale ?? null);
    default:
      return true;
  }
}
