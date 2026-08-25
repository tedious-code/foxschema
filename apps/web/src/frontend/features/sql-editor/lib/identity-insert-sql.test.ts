import { describe, expect, it } from 'vitest';
import { buildPeekInsert } from '@/features/sql-editor/lib/rowDml';

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
    // The Postgres family rejects an explicit GENERATED ALWAYS value without
    // this (SQLSTATE 428C9). Db2 is NOT one of them despite a similar error:
    // verified on Db2 LUW 11.5, the clause itself is SQL0104N there, so a Db2
    // GENERATED ALWAYS column is simply not writable — see the `unsupported`
    // entry in dialect-identity-insert.
    for (const d of ['postgres', 'cockroachdb', 'yugabytedb']) {
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
