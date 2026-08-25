import { describe, expect, it } from 'vitest';
import {
  boundPageCache,
  truncatePersistedSql,
  pruneSchemaCache,
  MAX_PERSISTED_SQL_CHARS,
} from './useSqlEditorStore';
import type { SqlStatementResult } from '@/shared/api/sqlApi';

const ok = (n: number): SqlStatementResult => ({
  ok: true,
  columns: ['id'],
  rows: [[n]],
  rowCount: 1,
  truncated: false,
  durationMs: 1,
});

describe('boundPageCache', () => {
  it('keeps at most 5 pages nearest the current page', () => {
    let cache: Record<string, SqlStatementResult> = {};
    for (let p = 0; p < 10; p++) {
      cache[`c1:0:${p}`] = ok(p);
      cache = boundPageCache(cache, 'c1', 0, 7);
    }
    const pages = Object.keys(cache)
      .map((k) => Number(k.split(':')[2]))
      .sort((a, b) => a - b);
    expect(pages).toHaveLength(5);
    expect(pages).toContain(7);
    expect(Math.max(...pages) - Math.min(...pages)).toBeLessThanOrEqual(7);
  });
});

describe('truncatePersistedSql', () => {
  it('caps oversized SQL', () => {
    const big = 'x'.repeat(MAX_PERSISTED_SQL_CHARS + 50);
    expect(truncatePersistedSql(big).length).toBe(MAX_PERSISTED_SQL_CHARS);
  });
});

describe('pruneSchemaCache', () => {
  it('drops expired ready entries', () => {
    const now = Date.now();
    const pruned = pruneSchemaCache(
      {
        old: { status: 'ready', tables: [], loadedAt: now - 20 * 60 * 1000 },
        fresh: { status: 'ready', tables: [], loadedAt: now },
      },
      now
    );
    expect(pruned.old).toBeUndefined();
    expect(pruned.fresh).toBeDefined();
  });
});
