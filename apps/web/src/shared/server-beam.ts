/**
 * Server Beam — cross-database `sql.on(alias)` helpers.

 */

export const MAX_SERVERS = 2;
export const MAX_SQL = 20;

/** Wire shape: alias → saved connection (password optional, session-only). */
export type BeamEndpointRef = {
  alias: string;
  connectionId: string;
  password?: string;
};

/**
 * Per-Execute counter for Server Beam SQL bridge calls.
 * Counts every bridged query (`sql`…`` and `sql.on`…``), not only `.on()`.
 * `take()` is synchronous so concurrent `answerQuery` handlers (after an
 * `await`) cannot slip past {@link MAX_SQL} on a single-threaded event loop.
 */
export function createBeamSqlCap(max = MAX_SQL): {
  take: () => void;
  readonly count: number;
} {
  let count = 0;
  return {
    take() {
      count += 1;
      if (count > max) {
        throw new Error(
          `Server Beam allows at most ${max} SQL bridge calls per editor Execute`
        );
      }
    },
    get count() {
      return count;
    },
  };
}

const ALIAS_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export function normalizeBeamAlias(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const a = raw.trim();
  if (!ALIAS_RE.test(a)) return null;
  return a;
}

/** True when a Node cell body uses Server Beam (`sql.on(...)`). */
export function usesServerBeam(body: string): boolean {
  return /\bsql\s*\.\s*on\s*\(/.test(body);
}

/**
 * Validate/normalize a `beam` array from the client.
 * At most {@link MAX_SERVERS} distinct aliases; aliases must be identifiers.
 */
export function parseBeamEndpoints(
  raw: unknown
): { ok: true; value: BeamEndpointRef[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'beam must be an array of { alias, connectionId }' };
  }
  if (raw.length > MAX_SERVERS) {
    return {
      ok: false,
      error: `Server Beam handles at most ${MAX_SERVERS} aliases (source, target)`,
    };
  }
  const out: BeamEndpointRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'beam entries must be objects' };
    }
    const o = item as Record<string, unknown>;
    const alias = normalizeBeamAlias(o.alias);
    if (!alias) {
      return {
        ok: false,
        error: 'beam alias must be an identifier (e.g. source, target)',
      };
    }
    if (seen.has(alias)) {
      return { ok: false, error: `Duplicate Server Beam alias "${alias}"` };
    }
    if (typeof o.connectionId !== 'string' || !o.connectionId.trim()) {
      return { ok: false, error: `beam alias "${alias}" needs a connectionId` };
    }
    seen.add(alias);
    const password = typeof o.password === 'string' && o.password ? o.password : undefined;
    out.push({ alias, connectionId: o.connectionId.trim(), password });
  }
  return { ok: true, value: out };
}

/** Default aliases when the UI maps checked Destinations in order. */
export function beamAliasesForCount(n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return ['source'];
  return ['source', 'target'];
}
