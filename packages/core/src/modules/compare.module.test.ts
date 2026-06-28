import { describe, it, expect } from 'vitest';
import { CompareModule } from './compare.module';
import { TableSchema } from '../interfaces';

const cmp = new CompareModule();

function table(partial: Partial<TableSchema> & { name: string }): TableSchema {
  return {
    objectType: 'TABLE',
    columns: [],
    indices: [],
    foreignKeys: [],
    ...partial,
  };
}

const col = (name: string, over: Partial<TableSchema['columns'][number]> = {}) => ({
  name,
  type: 'INTEGER',
  nullable: true,
  primaryKey: false,
  ...over,
});

describe('CompareModule.compare', () => {
  it('reports an added object when only the source has it', async () => {
    const r = await cmp.compare([table({ name: 'A' })], []);
    expect(r.summary).toMatchObject({ added: 1, removed: 0 });
    expect(r.tables[0].status).toBe('ADDED');
  });

  it('reports a removed object when only the target has it', async () => {
    const r = await cmp.compare([], [table({ name: 'A' })]);
    expect(r.summary).toMatchObject({ added: 0, removed: 1 });
    expect(r.tables[0].status).toBe('REMOVED');
  });

  it('treats identical tables as unchanged', async () => {
    const t = table({ name: 'A', columns: [col('ID', { nullable: false, primaryKey: true })] });
    const r = await cmp.compare([t], [structuredClone(t)]);
    expect(r.summary.unchanged).toBe(1);
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('matches schema-qualified vs unqualified names (CARTER.GPX vs GPX)', async () => {
    const r = await cmp.compare([table({ name: 'CARTER.GPX' })], [table({ name: 'GPX' })]);
    expect(r.tables).toHaveLength(1);
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('matches names case-insensitively', async () => {
    const r = await cmp.compare([table({ name: 'Orders' })], [table({ name: 'ORDERS' })]);
    expect(r.tables).toHaveLength(1);
  });

  it('flags a column type change as MODIFIED', async () => {
    const src = table({ name: 'A', columns: [col('AMT', { type: 'DECIMAL(10,2)' })] });
    const tgt = table({ name: 'A', columns: [col('AMT', { type: 'INTEGER' })] });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('MODIFIED');
    expect(r.tables[0].columnDiffs[0].status).toBe('MODIFIED');
  });

  it('detects an identity flag change', async () => {
    const src = table({ name: 'A', columns: [col('ID', { identity: true })] });
    const tgt = table({ name: 'A', columns: [col('ID', { identity: false })] });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('MODIFIED');
  });

  it('detects a primary-key column change', async () => {
    const src = table({ name: 'A', primaryKey: { name: 'PK', columns: ['ID', 'TENANT'] } });
    const tgt = table({ name: 'A', primaryKey: { name: 'PK', columns: ['ID'] } });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('MODIFIED');
  });

  it('detects a sequence attribute change', async () => {
    const src = table({ name: 'S', objectType: 'SEQUENCE', sequence: { increment: '1' } });
    const tgt = table({ name: 'S', objectType: 'SEQUENCE', sequence: { increment: '10' } });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('MODIFIED');
  });

  it('compares foreign keys ignoring the schema of the referenced table', async () => {
    const fk = { name: 'FK', columns: ['OID'], referencedColumns: ['ID'] };
    const src = table({ name: 'A', foreignKeys: [{ ...fk, referencedTable: 'HUY.ORDERS' }] });
    const tgt = table({ name: 'A', foreignKeys: [{ ...fk, referencedTable: 'VLAD.ORDERS' }] });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('UNCHANGED');
  });
});
