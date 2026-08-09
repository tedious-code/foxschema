import { describe, expect, it } from 'vitest';
import { buildPeekInsert } from './rowDml';

const build = (dialect: string, generation?: string) => {
  const b = buildPeekInsert({
    tableName: 'users',
    dialect,
    values: { id: 42, name: 'alice' },
    writeIdentityGeneration: generation,
  });
  return 'error' in b ? `ERROR ${b.error}` : b.sql;
};

describe('explicit identity INSERT is shaped per dialect', () => {
  it('adds OVERRIDING SYSTEM VALUE where the engine demands it', () => {
    // Postgres/Db2 reject an explicit GENERATED ALWAYS value without this
    // (SQLSTATE 428C9 / SQL0798N).
    for (const d of ['postgres', 'cockroachdb', 'yugabytedb', 'db2']) {
      expect(build(d, 'ALWAYS'), d).toContain('OVERRIDING SYSTEM VALUE');
      // It must sit between the column list and VALUES, not anywhere else.
      expect(build(d, 'ALWAYS'), d).toMatch(/\)\s+OVERRIDING SYSTEM VALUE\s+VALUES/);
    }
  });

  it('omits the clause for BY DEFAULT, which does not need it', () => {
    for (const d of ['postgres', 'db2']) {
      expect(build(d, 'BY DEFAULT'), d).not.toContain('OVERRIDING');
    }
  });

  it('leaves engines that accept explicit values untouched', () => {
    for (const d of ['mysql', 'mariadb', 'tidb', 'sqlite']) {
      expect(build(d, 'ALWAYS'), d).not.toContain('OVERRIDING');
    }
  });

  it('does not add a clause when identity is not being written', () => {
    // The default path — destination assigns ids — must be unchanged.
    expect(build('postgres', undefined)).toBe(
      'INSERT INTO "users" ("id", "name") VALUES ($1, $2)'
    );
  });

  it('still binds values rather than inlining them', () => {
    const b = buildPeekInsert({
      tableName: 'users',
      dialect: 'postgres',
      values: { id: 42, name: "O'Brien" },
      writeIdentityGeneration: 'ALWAYS',
    });
    expect('error' in b).toBe(false);
    if (!('error' in b)) {
      expect(b.sql).not.toContain("O'Brien");
      expect(b.params).toEqual([42, "O'Brien"]);
    }
  });
});
