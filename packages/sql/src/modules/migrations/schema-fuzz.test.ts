/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * A generated edge-case sweep across every dialect.
 *
 * The hand-written dialect tests cover the cases somebody thought of. This
 * builds adversarial schemas instead — reserved words as identifiers, mixed
 * casing, quote characters inside names, empty tables, composite keys — and
 * asserts properties that must hold for **all 14 dialects at once**. Where a
 * property is checked per dialect, the failure message names the dialect and
 * the seed, so a red run reproduces exactly.
 *
 * Everything is seeded and deterministic: a fuzz test that finds a different
 * bug on every CI run is a flaky test, not a fuzzer.
 */
import { describe, expect, it } from 'vitest';
import { CompareModule } from '../schema-diff/compare.module.js';
import { SqlGeneratorModule } from './sql-generator.module.js';
import { DIALECT_MAP } from '../dialect/registry.js';
import type { TableSchema, ColumnInfo } from '../../interfaces/index.js';

const DIALECTS = Object.keys(DIALECT_MAP);
const gen = new SqlGeneratorModule();

/** Deterministic PRNG (mulberry32) — same seed, same schema, every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(next: () => number, items: readonly T[]): T =>
  items[Math.floor(next() * items.length) % items.length]!;

/**
 * Identifiers chosen to be awkward on purpose.
 *
 * Reserved words are the common production break (a column actually called
 * `order` or `key`); the casing entries exist because the compare key is
 * uppercased and has been mistaken for the real identifier before.
 */
const NAMES = [
  'customer',
  'CUSTOMER',
  'Customer',
  'order', // reserved almost everywhere
  'select',
  'group',
  'user',
  'table',
  'index',
  'from',
  'primary',
  'mixed_Case_Name',
  'trailing_underscore_',
  'a', // single character
  'x'.repeat(64), // long, but under most identifier limits
];

/**
 * Names that have to be quoted or escaped to be legal at all.
 *
 * Kept separate from NAMES so a failure says which class of hostility broke:
 * a reserved word is a keyword problem, a name holding the dialect's own quote
 * character is an escaping problem, and the two have different fixes.
 */
const NEEDS_QUOTING = [
  'select', // reserved: a syntax error bare, on every engine
  'order',
  'key', // legal bare in SQLite, reserved in MySQL — quoted for all
  'user',
  'with space',
  'quote"inside',
  'back`tick',
  'bracket]close',
  'semi;colon',
  'dash-name',
  'naïve',
  'UPPER lower',
];

const TYPES = [
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'VARCHAR(10)',
  'VARCHAR(255)',
  'CHAR(1)',
  'TEXT',
  'DECIMAL(10,2)',
  'DATE',
  'TIMESTAMP',
  'BOOLEAN',
];

function column(next: () => number, name: string): ColumnInfo {
  return {
    name,
    type: pick(next, TYPES),
    nullable: next() > 0.3,
    primaryKey: false,
  };
}

/** One table with 1..6 awkward columns, sometimes a PK, index or FK. */
function table(next: () => number, name: string): TableSchema {
  const count = 1 + Math.floor(next() * 6);
  const used = new Set<string>();
  const columns: ColumnInfo[] = [];
  for (let i = 0; i < count; i++) {
    // Names are matched case-insensitively, so two columns differing only by
    // case are the *same* column — generating both would make an invalid table.
    const candidate = `${pick(next, NAMES)}_${i}`;
    if (used.has(candidate.toUpperCase())) continue;
    used.add(candidate.toUpperCase());
    columns.push(column(next, candidate));
  }
  if (columns.length === 0) columns.push(column(next, 'id_0'));

  const schema: TableSchema = {
    name,
    objectType: 'TABLE',
    columns,
    indices: [],
    foreignKeys: [],
  };

  if (next() > 0.4) {
    const pk = columns[0]!;
    pk.nullable = false;
    pk.primaryKey = true;
    schema.primaryKey = { name: `pk_${name}`, columns: [pk.name] };
  }
  if (next() > 0.6 && columns.length > 1) {
    schema.indices = [
      {
        name: `idx_${name}_${columns[1]!.name}`,
        columns: [columns[1]!.name],
        unique: next() > 0.7,
      },
    ];
  }
  return schema;
}

function schemaOf(seed: number): TableSchema[] {
  const next = rng(seed);
  const count = 1 + Math.floor(next() * 4);
  const names = new Set<string>();
  const tables: TableSchema[] = [];
  for (let i = 0; i < count; i++) {
    const name = `${pick(next, NAMES)}_t${i}`;
    if (names.has(name.toUpperCase())) continue;
    names.add(name.toUpperCase());
    tables.push(table(next, name));
  }
  return tables;
}

/** A plausible next version: add, drop, widen, retype, toggle nullability. */
function mutate(tables: TableSchema[], seed: number): TableSchema[] {
  const next = rng(seed + 977);
  return tables.map((t) => {
    const columns = t.columns
      .filter(() => next() > 0.2) // drop some
      .map((c) => (next() > 0.6 ? { ...c, type: pick(next, TYPES) } : c))
      .map((c) => (next() > 0.8 ? { ...c, nullable: !c.nullable && !c.primaryKey } : c));
    if (next() > 0.5) columns.push(column(next, `added_${Math.floor(next() * 1000)}`));
    // A table must keep at least one column to be a table at all.
    return { ...t, columns: columns.length > 0 ? columns : t.columns.slice(0, 1) };
  });
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

/** Every statement a migration plan would run, flattened. */
function planSql(diffs: Awaited<ReturnType<CompareModule['compare']>>, dialect: string): string[] {
  return gen
    .generateMigrationPlan(diffs.tables, dialect)
    .flatMap((step) => step.statements);
}

describe('generated schemas · self-compare is empty', () => {
  // The most basic promise the product makes: comparing a schema to itself
  // reports no work. A false positive here means the app invents a migration
  // for two identical databases.
  it.each(DIALECTS)('%s reports no changes against itself', async (dialect) => {
    for (const seed of SEEDS) {
      const tables = schemaOf(seed);
      const result = await new CompareModule().compare(tables, tables, {
        source: dialect,
        target: dialect,
      });
      const drifted = result.tables.filter((t) => t.status !== 'UNCHANGED');
      expect(
        drifted.map((t) => t.tableName),
        `${dialect} seed ${seed} invented a change`
      ).toEqual([]);
      expect(planSql(result, dialect), `${dialect} seed ${seed} emitted DDL`).toEqual([]);
    }
  });
});

describe('generated schemas · comparing the other way round', () => {
  it.each(DIALECTS)('%s mirrors added and removed when the sides swap', async (dialect) => {
    for (const seed of SEEDS) {
      const a = schemaOf(seed);
      const b = mutate(a, seed);
      const forward = await new CompareModule().compare(a, b, { source: dialect, target: dialect });
      const back = await new CompareModule().compare(b, a, { source: dialect, target: dialect });

      // "What must the target change to match the source" — swapping the sides
      // turns every addition into a removal. If these ever disagree the two
      // directions are telling the user different stories about one change.
      expect(forward.summary.added, `${dialect} seed ${seed}`).toBe(back.summary.removed);
      expect(forward.summary.removed, `${dialect} seed ${seed}`).toBe(back.summary.added);
      expect(forward.summary.modified, `${dialect} seed ${seed}`).toBe(back.summary.modified);
    }
  });
});

describe('generated schemas · the compare key never reaches the DDL', () => {
  // `tableName` is the uppercased match key, not an identifier. Emitting it is
  // a real bug that has shipped here before (and breaks case-sensitive MySQL).
  it.each(DIALECTS)('%s writes the table its own name', async (dialect) => {
    for (const seed of SEEDS) {
      const a = schemaOf(seed);
      const lower = a.filter((t) => t.name !== t.name.toUpperCase());
      if (lower.length === 0) continue;
      // Everything is new, so every table is written out in full.
      const result = await new CompareModule().compare(a, [], {
        source: dialect,
        target: dialect,
      });
      const sql = planSql(result, dialect).join('\n');
      for (const t of lower) {
        expect(sql, `${dialect} seed ${seed} lost the real name of ${t.name}`).toContain(t.name);
      }
    }
  });
});

describe('generated schemas · names that cannot be written bare', () => {
  // Every one of these is a legal name in a real database and none of them can
  // be emitted raw. The expected wrapper comes from the dialect itself, so a
  // dialect that changes its quoting style updates this test with it.
  it.each(DIALECTS)('%s quotes hostile table and column names', async (dialect) => {
    const quote =
      DIALECT_MAP[dialect]!.quoteIdentifier ?? ((n: string) => `"${n.replace(/"/g, '""')}"`);

    for (const name of NEEDS_QUOTING) {
      const result = await new CompareModule().compare(
        [
          {
            name,
            objectType: 'TABLE',
            columns: [{ name, type: 'INTEGER', nullable: true, primaryKey: false }],
            indices: [],
            foreignKeys: [],
          },
        ],
        [],
        { source: dialect, target: dialect }
      );
      const sql = planSql(result, dialect).join('\n');
      expect(sql, `${dialect} did not quote ${name}`).toContain(quote(name));
    }
  });
});

describe('generated schemas · statements are well-formed', () => {
  it.each(DIALECTS)('%s emits balanced quotes and parentheses', async (dialect) => {
    for (const seed of SEEDS) {
      const a = schemaOf(seed);
      const b = mutate(a, seed);
      const result = await new CompareModule().compare(a, b, { source: dialect, target: dialect });
      for (const statement of planSql(result, dialect)) {
        // Strip escaped string literals before counting, so a legitimate
        // '' inside a literal does not read as an unbalanced quote.
        const withoutLiterals = statement.replace(/''/g, '').replace(/'[^']*'/g, "''");
        const singles = (withoutLiterals.match(/'/g) ?? []).length;
        expect(singles % 2, `${dialect} seed ${seed}: odd quote count in ${statement}`).toBe(0);

        const opens = (statement.match(/\(/g) ?? []).length;
        const closes = (statement.match(/\)/g) ?? []).length;
        expect(opens, `${dialect} seed ${seed}: unbalanced parens in ${statement}`).toBe(closes);
      }
    }
  });
});

describe('type mapping · every dialect against every other', () => {
  // The migration path for a cross-dialect move is parse on the source side,
  // render on the target side. These are the properties that make that safe.
  const NATIVE = [
    ...TYPES,
    'VARCHAR(4000)',
    'NUMERIC(38,10)',
    'DOUBLE PRECISION',
    'TIMESTAMP(6)',
    'CHARACTER VARYING(50)',
  ];

  it.each(DIALECTS)('%s renders a usable type for anything it parses', (dialect) => {
    const d = DIALECT_MAP[dialect]!;
    for (const native of NATIVE) {
      const rendered = d.renderType(d.parseType(native));
      // An empty or `undefined` type reaches the DDL as `col ` and fails at the
      // engine — the one outcome that must never happen silently.
      expect(rendered.sql?.trim(), `${dialect} rendered nothing for ${native}`).toBeTruthy();
      expect(rendered.sql, `${dialect} rendered undefined for ${native}`).not.toMatch(
        /undefined|NaN|\[object/i
      );
    }
  });

  it.each(DIALECTS)('%s round-trips its own rendered type unchanged', (dialect) => {
    // Rendering must be a fixed point: parse(render(x)) === render(x). If it is
    // not, re-comparing a migrated database reports a change that is not there,
    // and the tool proposes the same migration forever.
    const d = DIALECT_MAP[dialect]!;
    for (const native of NATIVE) {
      const once = d.renderType(d.parseType(native)).sql;
      const twice = d.renderType(d.parseType(once)).sql;
      expect(twice, `${dialect}: ${native} → ${once} → ${twice}`).toBe(once);
    }
  });

  it('translates every type between every pair of dialects without dropping it', () => {
    const losses: string[] = [];
    for (const from of DIALECTS) {
      for (const to of DIALECTS) {
        if (from === to) continue;
        for (const native of NATIVE) {
          const rendered = DIALECT_MAP[to]!.renderType(DIALECT_MAP[from]!.parseType(native));
          if (!rendered.sql?.trim()) losses.push(`${from} → ${to}: ${native} rendered empty`);
        }
      }
    }
    expect(losses, losses.join('\n')).toEqual([]);
  });
});

describe('generated schemas · dialects cross-checked against each other', () => {
  it('agree on which objects need a migration', async () => {
    // The comparison is dialect-aware (type equivalence differs), but *which
    // tables changed* should not: a column dropped is dropped everywhere. One
    // dialect disagreeing with the other thirteen is the signal worth having.
    const disagreements: string[] = [];
    for (const seed of SEEDS) {
      const a = schemaOf(seed);
      const b = mutate(a, seed);
      const byDialect = new Map<string, string>();
      for (const dialect of DIALECTS) {
        const result = await new CompareModule().compare(a, b, {
          source: dialect,
          target: dialect,
        });
        byDialect.set(
          dialect,
          result.tables
            .filter((t) => t.status !== 'UNCHANGED')
            .map((t) => `${t.tableName}:${t.status}`)
            .sort()
            .join(',')
        );
      }
      const tally = new Map<string, string[]>();
      for (const [dialect, shape] of byDialect) {
        tally.set(shape, [...(tally.get(shape) ?? []), dialect]);
      }
      if (tally.size > 1) {
        const groups = [...tally.entries()]
          .map(([shape, names]) => `${names.join('+')} → ${shape || '(no changes)'}`)
          .join('  |  ');
        disagreements.push(`seed ${seed}: ${groups}`);
      }
    }
    expect(disagreements, disagreements.join('\n')).toEqual([]);
  });

  it('every dialect can express a change it reported', async () => {
    // A dialect that reports MODIFIED and then emits nothing has told the user
    // there is work to do and quietly refused to do it. Real limits exist
    // (SQLite cannot drop arbitrary columns), so this reports rather than
    // asserting a hard equality — the list is the finding.
    const silent: string[] = [];
    for (const seed of SEEDS) {
      const a = schemaOf(seed);
      const b = mutate(a, seed);
      for (const dialect of DIALECTS) {
        const result = await new CompareModule().compare(a, b, {
          source: dialect,
          target: dialect,
        });
        const changed = result.tables.filter((t) => t.status !== 'UNCHANGED');
        if (changed.length > 0 && planSql(result, dialect).length === 0) {
          silent.push(`${dialect} seed ${seed}: ${changed.length} changed, 0 statements`);
        }
      }
    }
    expect(silent, silent.join('\n')).toEqual([]);
  });
});
