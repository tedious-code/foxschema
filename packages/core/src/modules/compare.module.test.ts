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

  it('treats equivalent cross-dialect types as UNCHANGED', async () => {
    // DB2 VARCHAR(255) vs Postgres character varying(255) — same type, different spelling
    const src = table({ name: 'A', columns: [col('NAME', { type: 'VARCHAR(255)' })] });
    const tgt = table({ name: 'A', columns: [col('NAME', { type: 'character varying(255)' })] });
    const r = await cmp.compare([src], [tgt], { source: 'db2', target: 'postgres' });
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('still flags a genuine cross-dialect type change', async () => {
    const src = table({ name: 'A', columns: [col('AMT', { type: 'DECIMAL(10,2)' })] });
    const tgt = table({ name: 'A', columns: [col('AMT', { type: 'integer' })] });
    const r = await cmp.compare([src], [tgt], { source: 'db2', target: 'postgres' });
    expect(r.tables[0].status).toBe('MODIFIED');
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

  it('treats a trigger as UNCHANGED when its body differs only by the schema of a routine call', async () => {
    // After a successful migration the deployed trigger re-qualifies the function call
    // to the target schema, so a raw compare kept flagging the table as MODIFIED forever.
    const trg = (schema: string) => ({
      name: 'TRG_CUSTOMER_TIER', timing: 'BEFORE', event: 'INSERT',
      definition: `BEGIN\n  IF ${schema}.fn_tier_priority(:NEW.tier) = 0 THEN :NEW.tier := 'standard'; END IF;\nEND;`,
    });
    const src = table({ name: 'CUSTOMERS', triggers: [trg('demo_a')] });
    const tgt = table({ name: 'CUSTOMERS', triggers: [trg('demo_b')] });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('UNCHANGED');
    expect(r.tables[0].triggerDiffs?.find((t) => t.name === 'TRG_CUSTOMER_TIER')?.status).toBe('UNCHANGED');
  });

  it('still flags a real trigger body change', async () => {
    const mk = (tier: string) => ({
      name: 'TRG_CUSTOMER_TIER', timing: 'BEFORE', event: 'INSERT',
      definition: `BEGIN\n  IF demo_a.fn_tier_priority(:NEW.tier) = 0 THEN :NEW.tier := '${tier}'; END IF;\nEND;`,
    });
    const src = table({ name: 'CUSTOMERS', triggers: [mk('standard')] });
    const tgt = table({ name: 'CUSTOMERS', triggers: [mk('gold')] });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('MODIFIED');
  });

  it('ignores the schema (and its case) on an Oracle sequence column default', async () => {
    // demo_a.order_seq.NEXTVAL vs DEMO_B.order_seq.NEXTVAL is the same sequence after
    // a migration re-qualifies it to the target schema — must not read as MODIFIED.
    const src = table({ name: 'ORDERS', columns: [col('ID', { type: 'NUMBER', defaultValue: 'demo_a.order_seq.NEXTVAL' })] });
    const tgt = table({ name: 'ORDERS', columns: [col('ID', { type: 'NUMBER', defaultValue: 'DEMO_B.order_seq.NEXTVAL' })] });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('still flags a default that points at a genuinely different sequence', async () => {
    const src = table({ name: 'ORDERS', columns: [col('ID', { type: 'NUMBER', defaultValue: 'demo_a.order_seq.NEXTVAL' })] });
    const tgt = table({ name: 'ORDERS', columns: [col('ID', { type: 'NUMBER', defaultValue: 'demo_b.other_seq.NEXTVAL' })] });
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('MODIFIED');
  });

  it('treats a routine body that differs only by a trailing terminator/whitespace as UNCHANGED', async () => {
    const fn = (def: string) => table({ name: 'FN_GET_DISCOUNT', objectType: 'FUNCTION', definition: def });
    const src = fn('\nCREATE FUNCTION FN_GET_DISCOUNT() RETURNS INT AS BEGIN RETURN 1; END;\n');
    const tgt = fn('CREATE FUNCTION FN_GET_DISCOUNT() RETURNS INT AS BEGIN RETURN 1; END');
    const r = await cmp.compare([src], [tgt]);
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('strips the source/target schema qualifiers everywhere in a trigger body', async () => {
    // ON demo_a.customers, FROM demo_a.customers, demo_a.fn(...) — the migration
    // re-qualifies all of these to the target schema, so it must read as UNCHANGED.
    const trig = (sc: string) => ({
      name: 'TRG_CUSTOMER_TIER', timing: 'AFTER', event: 'INSERT',
      definition: `CREATE TRIGGER ${sc}.trg ON ${sc}.customers AFTER INSERT AS BEGIN UPDATE c SET tier='x' FROM ${sc}.customers c WHERE ${sc}.fn_tier_priority(c.tier)=0; END`,
    });
    const src = table({ name: 'CUSTOMERS', triggers: [trig('demo_a')] });
    const tgt = table({ name: 'CUSTOMERS', triggers: [trig('demo_b')] });
    const r = await cmp.compare([src], [tgt], undefined, { source: 'demo_a', target: 'demo_b' });
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('ignores the schema on a SQL Server NEXT VALUE FOR sequence default', async () => {
    const c = (sc: string) => col('ID', { type: 'int', defaultValue: `NEXT VALUE FOR [${sc}].[order_seq]` });
    const src = table({ name: 'ORDERS', columns: [c('demo_a')] });
    const tgt = table({ name: 'ORDERS', columns: [c('demo_b')] });
    const r = await cmp.compare([src], [tgt], undefined, { source: 'demo_a', target: 'demo_b' });
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('ignores the schema on a MariaDB backtick-quoted nextval() sequence default', async () => {
    const c = (sc: string) => col('ID', { type: 'bigint(20)', defaultValue: `nextval(\`${sc}\`.\`order_seq\`)` });
    const src = table({ name: 'ORDERS', columns: [c('demo_a')] });
    const tgt = table({ name: 'ORDERS', columns: [c('demo_b')] });
    const r = await cmp.compare([src], [tgt], undefined, { source: 'demo_a', target: 'demo_b' });
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('compares index and foreign-key columns case-insensitively', async () => {
    // One schema reads columns lowercase, the other uppercase (e.g. after a migration
    // re-emits DDL) — the same columns must not read as a MODIFIED index/FK.
    const mk = (cols: string) => table({
      name: 'PRODUCTS',
      indices: [{ name: 'IDX_CAT', columns: [cols], unique: false }],
      foreignKeys: [{ name: 'FK_CAT', columns: [cols], referencedTable: 'CATEGORIES', referencedColumns: [cols] }],
    });
    const r = await cmp.compare([mk('category_id')], [mk('CATEGORY_ID')]);
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('still flags a genuine index column change', async () => {
    const mk = (cols: string[]) => table({ name: 'PRODUCTS', indices: [{ name: 'IDX', columns: cols, unique: false }] });
    const r = await cmp.compare([mk(['sku', 'name'])], [mk(['sku'])]);
    expect(r.tables[0].status).toBe('MODIFIED');
  });

  it('flags a same-dialect collation difference as MODIFIED', async () => {
    const src = table({ name: 'CUSTOMERS', columns: [col('NAME', { type: 'varchar(150)', collation: 'utf8mb4_unicode_ci' })] });
    const tgt = table({ name: 'CUSTOMERS', columns: [col('NAME', { type: 'varchar(150)', collation: 'utf8mb4_general_ci' })] });
    const r = await cmp.compare([src], [tgt], { source: 'mysql', target: 'mysql' });
    expect(r.tables[0].status).toBe('MODIFIED');
    expect(r.tables[0].columnDiffs.find((c) => c.name === 'NAME')?.status).toBe('MODIFIED');
  });

  it('does not flag identical same-dialect collations', async () => {
    const mk = () => table({ name: 'CUSTOMERS', columns: [col('NAME', { type: 'varchar(150)', collation: 'utf8mb4_unicode_ci' })] });
    const r = await cmp.compare([mk()], [mk()], { source: 'mysql', target: 'mysql' });
    expect(r.tables[0].status).toBe('UNCHANGED');
  });

  it('ignores a collation difference across genuinely different dialects (not comparable vocabularies)', async () => {
    const src = table({ name: 'CUSTOMERS', columns: [col('NAME', { type: 'varchar(150)', collation: 'utf8mb4_unicode_ci' })] });
    const tgt = table({ name: 'CUSTOMERS', columns: [col('NAME', { type: 'character varying(150)', collation: 'en_US.utf8' })] });
    const r = await cmp.compare([src], [tgt], { source: 'mysql', target: 'postgres' });
    // Cross-dialect: type is canonically equal (varchar(150) both sides) and collation
    // is skipped entirely — must not spuriously flag MODIFIED from collation alone.
    expect(r.tables[0].columnDiffs.find((c) => c.name === 'NAME')?.status).toBe('UNCHANGED');
  });

  it('does not flag when neither side has a collation (non-character columns, or DB2)', async () => {
    const mk = () => table({ name: 'ORDERS', columns: [col('ID', { type: 'int' })] });
    const r = await cmp.compare([mk()], [mk()]);
    expect(r.tables[0].status).toBe('UNCHANGED');
  });
});
