import { describe, expect, it } from 'vitest';
import { parseSqlSubset, subsetValue, type SubsetIntent } from './sql-subset.js';

const ok = (sql: string): SubsetIntent => {
  const r = parseSqlSubset(sql);
  if (!r.ok) throw new Error(`expected parse, got: ${r.error}`);
  return r.intent;
};
const err = (sql: string): string => {
  const r = parseSqlSubset(sql);
  if (r.ok) throw new Error(`expected refusal, got ${JSON.stringify(r.intent)}`);
  return r.error;
};

describe('accepts exactly the shapes the app emits', () => {
  it('INSERT with each placeholder style', () => {
    for (const [sql, style] of [
      ['INSERT INTO "users" ("id", "name") VALUES ($1, $2)', 'dollar'],
      ['INSERT INTO `users` (`id`, `name`) VALUES (?, ?)', 'question'],
      ['INSERT INTO "users" ("id", "name") VALUES (:1, :2)', 'colon'],
    ] as const) {
      const intent = ok(sql);
      expect(intent.kind, style).toBe('insert');
      if (intent.kind === 'insert') {
        expect(intent.table, style).toBe('users');
        expect(intent.assignments.map((a) => a.column), style).toEqual(['id', 'name']);
        expect(intent.assignments.map((a) => subsetValue(a.value, ['A', 'B'])), style).toEqual([
          'A',
          'B',
        ]);
      }
    }
  });

  it('UPDATE with a composite key', () => {
    const intent = ok('UPDATE "t" SET "a" = ?, "b" = ? WHERE "k1" = ? AND "k2" = ?');
    expect(intent.kind).toBe('update');
    if (intent.kind === 'update') {
      expect(intent.set.map((s) => s.column)).toEqual(['a', 'b']);
      expect(intent.where.map((w) => w.column)).toEqual(['k1', 'k2']);
      // Params are positional across SET then WHERE — order must survive.
      expect(intent.set.map((s) => subsetValue(s.value, [1, 2, 3, 4]))).toEqual([1, 2]);
      expect(intent.where.map((w) => subsetValue(w.value, [1, 2, 3, 4]))).toEqual([3, 4]);
    }
  });

  it('DELETE with a composite key', () => {
    const intent = ok('DELETE FROM [dbo].[t] WHERE [k1] = ? AND [k2] = ?');
    expect(intent.kind).toBe('delete');
    if (intent.kind === 'delete') {
      expect(intent.table).toBe('t'); // schema dropped — one namespace
      expect(intent.where).toHaveLength(2);
    }
  });

  it('SELECT with and without predicates and limit', () => {
    expect(ok('SELECT * FROM users')).toMatchObject({ kind: 'select', columns: '*', where: [] });
    expect(ok('SELECT "a", "b" FROM t LIMIT 10')).toMatchObject({
      columns: ['a', 'b'],
      limit: 10,
    });
    expect(ok('SELECT * FROM t WHERE "k" = ? LIMIT 5')).toMatchObject({
      limit: 5,
      where: [{ column: 'k' }],
    });
  });

  it('reads literals as well as placeholders', () => {
    const intent = ok("SELECT * FROM t WHERE a = 1 AND b = 'x' AND d = TRUE");
    if (intent.kind !== 'select') throw new Error('shape');
    expect(intent.where.map((w) => subsetValue(w.value, []))).toEqual([1, 'x', true]);
  });

  it('allows NULL as an INSERT / SET value', () => {
    expect(ok("INSERT INTO t (a, b) VALUES (1, NULL)").kind).toBe('insert');
    const intent = ok("UPDATE t SET a = NULL WHERE k = 1");
    expect(intent.kind).toBe('update');
  });

  it("unescapes '' inside a literal", () => {
    const intent = ok("DELETE FROM t WHERE name = 'O''Brien'");
    if (intent.kind !== 'delete') throw new Error('shape');
    expect(subsetValue(intent.where[0]!.value, [])).toBe("O'Brien");
  });
});

describe('refuses everything it cannot represent exactly', () => {
  // This is the whole safety argument: a translator that accepts these and
  // drops what it does not understand deletes or overwrites the wrong rows.
  const mustRefuse: Array<[string, string]> = [
    ['range predicate', 'DELETE FROM t WHERE age > 65'],
    ['range predicate >=', 'DELETE FROM t WHERE age >= 65'],
    ['not equal', 'DELETE FROM t WHERE age != 65'],
    ['not equal <>', 'DELETE FROM t WHERE age <> 65'],
    ['OR', 'DELETE FROM t WHERE a = 1 OR b = 2'],
    ['IN list', 'DELETE FROM t WHERE id IN (1, 2)'],
    ['LIKE', "SELECT * FROM t WHERE name LIKE 'a%'"],
    ['IS NULL', 'DELETE FROM t WHERE a IS NULL'],
    // `= NULL` is not SQL equality, and MongoDB `{a: null}` matches missing fields.
    ['equality to NULL', 'DELETE FROM t WHERE a = NULL'],
    ['equality to NULL in SELECT', 'SELECT * FROM t WHERE a = NULL'],
    ['equality to NULL in UPDATE WHERE', 'UPDATE t SET b = 1 WHERE a = NULL'],
    ['BETWEEN', 'DELETE FROM t WHERE a BETWEEN 1 AND 5'],
    ['function call', 'SELECT * FROM t WHERE lower(a) = ?'],
    ['expression value', 'UPDATE t SET a = a + 1 WHERE k = ?'],
    ['subquery', 'DELETE FROM t WHERE id = (SELECT id FROM u)'],
    ['join', 'SELECT * FROM a JOIN b ON a.id = b.id'],
    ['UPDATE without WHERE', 'UPDATE t SET a = 1'],
    ['DELETE without WHERE', 'DELETE FROM t'],
    ['TRUNCATE', 'TRUNCATE TABLE t'],
    ['DDL', 'DROP TABLE t'],
    ['batch', 'DELETE FROM t WHERE k = 1; DELETE FROM u WHERE k = 2'],
    ['order by', 'SELECT * FROM t ORDER BY a'],
    ['group by', 'SELECT count(*) FROM t GROUP BY a'],
  ];

  for (const [label, sql] of mustRefuse) {
    it(`refuses ${label}`, () => {
      const message = err(sql);
      expect(message.length).toBeGreaterThan(10); // must explain, not just fail
    });
  }

  it('refuses an unbalanced statement rather than guessing', () => {
    expect(err("SELECT * FROM t WHERE a = 'unterminated")).toBeTruthy();
    expect(err('SELECT * FROM t WHERE (a = 1')).toBeTruthy();
  });

  it('does not mistake >= for = by reading only the last character', () => {
    // The subtle one: splitting on '=' finds the '=' inside '>=', so the guard
    // has to look at what precedes it.
    const r = parseSqlSubset('DELETE FROM t WHERE a >= 5');
    expect(r.ok).toBe(false);
  });
});

describe('parameter indexing', () => {
  it('numbers ? placeholders left to right across SET then WHERE', () => {
    const intent = ok('UPDATE t SET a = ?, b = ? WHERE k = ?');
    if (intent.kind !== 'update') throw new Error('shape');
    const params = ['sa', 'sb', 'wk'];
    expect(intent.set.map((s) => subsetValue(s.value, params))).toEqual(['sa', 'sb']);
    expect(intent.where.map((w) => subsetValue(w.value, params))).toEqual(['wk']);
  });

  it('honours explicit $n ordering rather than position', () => {
    const intent = ok('UPDATE t SET a = $2 WHERE k = $1');
    if (intent.kind !== 'update') throw new Error('shape');
    expect(subsetValue(intent.set[0]!.value, ['first', 'second'])).toBe('second');
    expect(subsetValue(intent.where[0]!.value, ['first', 'second'])).toBe('first');
  });

  it('yields null for a parameter that was not supplied', () => {
    const intent = ok('DELETE FROM t WHERE k = ?');
    if (intent.kind !== 'delete') throw new Error('shape');
    expect(subsetValue(intent.where[0]!.value, [])).toBeNull();
  });
});
