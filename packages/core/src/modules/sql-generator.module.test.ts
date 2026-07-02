import { describe, it, expect } from 'vitest';
import { SqlGeneratorModule } from './sql-generator.module';
import { TableDiff } from '../interfaces';
import { TableSchema } from '../interfaces';

const gen = new SqlGeneratorModule();

const tableSchema = (over: Partial<TableSchema> & { name: string }): TableSchema => ({
  objectType: 'TABLE',
  columns: [],
  indices: [],
  foreignKeys: [],
  ...over,
});

describe('SqlGeneratorModule.generateObjectDdl', () => {
  it('renders a composite primary key as a table-level constraint', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({
        name: 'ORDERS',
        primaryKey: { name: 'PK_ORDERS', columns: ['ORDER_ID', 'LINE_NO'] },
        columns: [
          { name: 'ORDER_ID', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'LINE_NO', type: 'INTEGER', nullable: false, primaryKey: true },
        ],
      })
    );
    expect(ddl).toContain('CONSTRAINT PK_ORDERS PRIMARY KEY (ORDER_ID, LINE_NO)');
    // must NOT inline PRIMARY KEY per column (invalid for composite keys)
    expect(ddl).not.toMatch(/INTEGER NOT NULL PRIMARY KEY/);
  });

  it('renders an identity column', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({
        name: 'T',
        columns: [{ name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true, identity: true, identityGeneration: 'ALWAYS' }],
      })
    );
    expect(ddl).toContain('GENERATED ALWAYS AS IDENTITY');
  });

  it('renders a sequence with its attributes', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({ name: 'SEQ', objectType: 'SEQUENCE', sequence: { dataType: 'BIGINT', start: '1', increment: '1', cache: 20 } })
    );
    expect(ddl).toContain('CREATE SEQUENCE IF NOT EXISTS SEQ AS BIGINT START WITH 1 INCREMENT BY 1');
    expect(ddl).toContain('CACHE 20');
  });

  it('renders a structured type with its attributes', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({ name: 'ADDR', objectType: 'TYPE', userType: { attributes: [{ name: 'STREET', type: 'VARCHAR(100)' }] } })
    );
    expect(ddl).toContain('CREATE TYPE ADDR AS (');
    expect(ddl).toContain('STREET VARCHAR(100)');
  });
});

describe('SqlGeneratorModule.generateMigrationPlan', () => {
  const addedTable = (name: string): TableDiff => ({
    tableName: name,
    objectType: 'TABLE',
    status: 'ADDED',
    columnDiffs: [],
    indexDiffs: [],
    foreignKeyDiffs: [],
    sourceTable: tableSchema({ name, columns: [{ name: 'ID', type: 'INTEGER', nullable: false, primaryKey: false }] }),
  });

  it('orders steps drop → create → alter', () => {
    const diffs: TableDiff[] = [
      { ...addedTable('NEW') },
      { tableName: 'OLD', objectType: 'TABLE', status: 'REMOVED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [], targetTable: tableSchema({ name: 'OLD' }) },
    ];
    const plan = gen.generateMigrationPlan(diffs, 'db2');
    expect(plan.map((s) => s.action)).toEqual(['DROP', 'CREATE']);
  });

  it('re-qualifies object names to the target schema regardless of source prefix', () => {
    const plan = gen.generateMigrationPlan([addedTable('CARTER.GPX')], 'db2', { sourceSchema: 'HUY', targetSchema: 'VLAD' });
    const sql = plan.flatMap((s) => s.statements).join('\n');
    expect(sql).toContain('CREATE TABLE VLAD.GPX');
    expect(sql).not.toContain('CARTER.');
  });

  it('emits nothing when there are no changes', () => {
    const plan = gen.generateMigrationPlan([
      { tableName: 'A', objectType: 'TABLE', status: 'UNCHANGED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [] },
    ], 'db2');
    expect(plan).toHaveLength(0);
  });

  it('translates source column types into the target dialect (DB2 → Postgres)', () => {
    const diff: TableDiff = {
      tableName: 'DOC',
      objectType: 'TABLE',
      status: 'ADDED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({
        name: 'DOC',
        columns: [
          { name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'BODY', type: 'CLOB(1048576)', nullable: true, primaryKey: false },
          { name: 'AMT', type: 'DECIMAL(10,2)', nullable: true, primaryKey: false },
        ],
      }),
    };
    const sql = gen.generateMigrationPlan([diff], 'postgres', { sourceDialect: 'db2' }).flatMap((s) => s.statements).join('\n');
    expect(sql).toContain('BODY text');
    expect(sql).toContain('AMT numeric(10,2)');
    expect(sql).not.toContain('CLOB');
  });

  it('creates the backing sequence before a Postgres serial table (cross-schema)', () => {
    const diff: TableDiff = {
      tableName: 'demo_b.PRODUCTS',
      objectType: 'TABLE',
      status: 'ADDED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({
        name: 'demo_b.PRODUCTS',
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true, defaultValue: "nextval('demo_b.products_id_seq'::regclass)" },
          { name: 'name', type: 'varchar(200)', nullable: false, primaryKey: false },
        ],
      }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres', {
      sourceDialect: 'postgres', sourceSchema: 'demo_b', targetSchema: 'app',
    }).flatMap((s) => s.statements);
    const createSeqIdx = stmts.findIndex((s) => /CREATE SEQUENCE IF NOT EXISTS app\.products_id_seq;/.test(s));
    const createTblIdx = stmts.findIndex((s) => /CREATE TABLE app\.PRODUCTS/.test(s));
    expect(createSeqIdx).toBeGreaterThanOrEqual(0);
    // sequence must be created BEFORE the table that references it
    expect(createSeqIdx).toBeLessThan(createTblIdx);
    // and the column default must resolve to the same (remapped) sequence
    expect(stmts.some((s) => s.includes("nextval('app.products_id_seq'::regclass)"))).toBe(true);
    expect(stmts.some((s) => /ALTER SEQUENCE app\.products_id_seq OWNED BY app\.PRODUCTS\.id;/.test(s))).toBe(true);
  });

  it('does not emit CREATE SEQUENCE for non-Postgres targets', () => {
    const diff: TableDiff = {
      tableName: 'PRODUCTS', objectType: 'TABLE', status: 'ADDED',
      columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'PRODUCTS', columns: [{ name: 'id', type: 'INTEGER', nullable: false, primaryKey: true, identity: true }] }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'db2').flatMap((s) => s.statements);
    expect(stmts.some((s) => /CREATE SEQUENCE/.test(s))).toBe(false);
  });

  it('is a no-op for same-dialect migrations (raw type preserved)', () => {
    const diff: TableDiff = {
      tableName: 'DOC',
      objectType: 'TABLE',
      status: 'ADDED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'DOC', columns: [{ name: 'BODY', type: 'CLOB', nullable: true, primaryKey: false }] }),
    };
    const sql = gen.generateMigrationPlan([diff], 'db2', { sourceDialect: 'db2' }).flatMap((s) => s.statements).join('\n');
    expect(sql).toContain('BODY CLOB');
  });

  it('emits a manual-review block for procedural objects across dialects', () => {
    const diff: TableDiff = {
      tableName: 'V_ORDERS',
      objectType: 'VIEW',
      status: 'ADDED',
      definition: 'CREATE VIEW V_ORDERS AS SELECT * FROM ORDERS',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres', { sourceDialect: 'oracle' }).flatMap((s) => s.statements);
    expect(stmts.some((s) => s.includes('MANUAL REVIEW REQUIRED'))).toBe(true);
    // the raw body must not be emitted as an executable statement
    expect(stmts.some((s) => /^\s*CREATE VIEW/.test(s))).toBe(false);
  });

  it('creates an ADDED function before a MODIFIED table\'s ALTER step adds a trigger that calls it', () => {
    // Regression: a MODIFIED table's ALTER can add a new trigger whose EXECUTE
    // FUNCTION clause calls a function that is itself only ADDED in this same
    // migration. The function must be created before the ALTER runs, not after.
    const modifiedTableWithNewTrigger: TableDiff = {
      tableName: 'CUSTOMERS',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      triggerDiffs: [{
        name: 'TRG_CUSTOMER_CREATED',
        status: 'ADDED',
        source: { definition: 'CREATE TRIGGER TRG_CUSTOMER_CREATED BEFORE INSERT ON CUSTOMERS FOR EACH ROW EXECUTE FUNCTION TRG_UPDATE_TS()' },
      }],
    };
    const addedFunction: TableDiff = {
      tableName: 'TRG_UPDATE_TS',
      objectType: 'FUNCTION',
      status: 'ADDED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      definition: 'CREATE FUNCTION TRG_UPDATE_TS() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$',
    };
    const steps = gen.generateMigrationPlan([modifiedTableWithNewTrigger, addedFunction], 'postgres');
    const functionStepIndex = steps.findIndex((s) => s.objectType === 'FUNCTION');
    const alterStepIndex = steps.findIndex((s) => s.objectType === 'TABLE' && s.action === 'ALTER');
    expect(functionStepIndex).toBeGreaterThanOrEqual(0);
    expect(alterStepIndex).toBeGreaterThanOrEqual(0);
    expect(functionStepIndex).toBeLessThan(alterStepIndex);
  });

  it('drops a MODIFIED function with a bare name on MySQL (no parenthesized signature)', () => {
    // Regression: MySQL/MariaDB/SQL Server reject ANY parenthesized signature on
    // DROP FUNCTION, even an empty one — only Postgres/Redshift support overloading.
    const diff: TableDiff = {
      tableName: 'FN_GET_DISCOUNT',
      objectType: 'FUNCTION',
      status: 'MODIFIED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      definition: 'CREATE FUNCTION FN_GET_DISCOUNT(p_price DECIMAL(10,2), p_qty INT) RETURNS DECIMAL(10,2) ...',
      sourceTable: tableSchema({
        name: 'FN_GET_DISCOUNT',
        objectType: 'FUNCTION',
        parameters: [
          { name: 'p_price', type: 'decimal(10,2)', mode: 'IN' },
          { name: 'p_qty', type: 'int', mode: 'IN' },
        ],
      }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'mysql').flatMap((s) => s.statements);
    expect(stmts).toContain('DROP FUNCTION IF EXISTS FN_GET_DISCOUNT;');
    expect(stmts.some((s) => /DROP FUNCTION IF EXISTS FN_GET_DISCOUNT\(/.test(s))).toBe(false);
  });

  it('drops a MODIFIED function with its parameter signature on Postgres', () => {
    const diff: TableDiff = {
      tableName: 'FN_GET_DISCOUNT',
      objectType: 'FUNCTION',
      status: 'MODIFIED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      definition: 'CREATE FUNCTION FN_GET_DISCOUNT(p_price numeric, p_qty integer) RETURNS numeric ...',
      sourceTable: tableSchema({
        name: 'FN_GET_DISCOUNT',
        objectType: 'FUNCTION',
        parameters: [
          { name: 'p_price', type: 'numeric', mode: 'IN' },
          { name: 'p_qty', type: 'integer', mode: 'IN' },
        ],
      }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres').flatMap((s) => s.statements);
    expect(stmts).toContain('DROP FUNCTION IF EXISTS FN_GET_DISCOUNT(numeric, integer);');
  });

  it('drops then recreates a modified trigger', () => {
    const diff: TableDiff = {
      tableName: 'ORDERS',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      triggerDiffs: [{ name: 'TRG', status: 'MODIFIED', source: { definition: 'CREATE TRIGGER TRG ...' } }],
    };
    const stmts = gen.generateMigrationPlan([diff], 'db2').flatMap((s) => s.statements);
    expect(stmts).toContain('DROP TRIGGER TRG;');
    expect(stmts.some((s) => s.includes('CREATE TRIGGER TRG'))).toBe(true);
  });

  it('guards Postgres column changes with a correct pg_depend/pg_rewrite view block', () => {
    const diff: TableDiff = {
      tableName: 'app.ORDERS',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [
        { name: 'TOTAL', status: 'MODIFIED', source: { type: 'numeric(12,2)', nullable: false }, target: { type: 'numeric(10,2)', nullable: false } },
      ],
      indexDiffs: [],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'ORDERS', columns: [] }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres', { targetSchema: 'app' }).flatMap((s) => s.statements);
    const preIdx = stmts.findIndex((s) => s.includes('$fs_pre$'));
    const alterIdx = stmts.findIndex((s) => /ALTER COLUMN TOTAL TYPE/i.test(s));
    const postIdx = stmts.findIndex((s) => s.includes('$fs_post$'));
    // pre-drop → alter → post-recreate ordering
    expect(preIdx).toBeGreaterThanOrEqual(0);
    expect(alterIdx).toBeGreaterThan(preIdx);
    expect(postIdx).toBeGreaterThan(alterIdx);
    // the discovery query MUST hop pg_depend -> pg_rewrite -> pg_class, else it finds
    // zero views (objid is a rewrite-rule oid, not the view's pg_class oid).
    const pre = stmts[preIdx];
    expect(pre).toContain('pg_rewrite');
    expect(pre).toContain('rw.ev_class');
    expect(pre).toMatch(/refobjid = 'app\.ORDERS'::regclass/);
    // recreate must re-RAISE on failure (never swallow) so the whole migration rolls
    // back, but with a clear FoxSchema message rather than a bare catalog error.
    expect(stmts[postIdx]).toMatch(/RAISE EXCEPTION 'FoxSchema:/);
  });

  it('guards a Postgres DROP COLUMN (not just type changes) but skips ADD-only changes', () => {
    const removed: TableDiff = {
      tableName: 'app.ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [{ name: 'OLD_COL', status: 'REMOVED', target: { type: 'integer', nullable: true } }],
      indexDiffs: [], foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'app.ORDERS', columns: [] }),
    };
    const addOnly: TableDiff = {
      tableName: 'app.ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [{ name: 'NEW_COL', status: 'ADDED', source: { type: 'integer', nullable: true } }],
      indexDiffs: [], foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'app.ORDERS', columns: [] }),
    };
    const removedStmts = gen.generateMigrationPlan([removed], 'postgres').flatMap((s) => s.statements);
    const addStmts = gen.generateMigrationPlan([addOnly], 'postgres').flatMap((s) => s.statements);
    // DROP COLUMN can be blocked by a dependent view -> must be guarded
    expect(removedStmts.some((s) => s.includes('$fs_pre$'))).toBe(true);
    // ADD COLUMN is never blocked by a view -> no need for the view dance
    expect(addStmts.some((s) => s.includes('$fs_pre$'))).toBe(false);
  });

  it('applies a changed column DEFAULT and creates the referenced sequence (Postgres)', () => {
    const diff: TableDiff = {
      tableName: 'app.ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [
        { name: 'id', status: 'MODIFIED',
          source: { type: 'integer', nullable: false, defaultValue: "nextval('order_seq'::regclass)" },
          target: { type: 'integer', nullable: false, defaultValue: "nextval('orders_id_seq'::regclass)" } },
      ],
      indexDiffs: [], foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'app.ORDERS', columns: [] }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres', { targetSchema: 'app' }).flatMap((s) => s.statements);
    expect(stmts.some((s) => /CREATE SEQUENCE IF NOT EXISTS app\.order_seq;/.test(s))).toBe(true);
    expect(stmts.some((s) => /ALTER COLUMN id SET DEFAULT nextval\('order_seq'::regclass\)/i.test(s))).toBe(true);
  });

  it('drops a column DEFAULT when the source no longer has one', () => {
    const diff: TableDiff = {
      tableName: 'ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [
        { name: 'status', status: 'MODIFIED',
          source: { type: 'varchar(20)', nullable: false },
          target: { type: 'varchar(20)', nullable: false, defaultValue: "'PENDING'" } },
      ],
      indexDiffs: [], foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'ORDERS', columns: [] }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres').flatMap((s) => s.statements);
    expect(stmts.some((s) => /ALTER COLUMN status DROP DEFAULT;/.test(s))).toBe(true);
  });

  it('does NOT emit a raw DEFAULT across dialects — flags it for review instead', () => {
    const diff: TableDiff = {
      tableName: 'ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [
        { name: 'created_at', status: 'MODIFIED',
          source: { type: 'TIMESTAMP', nullable: false, defaultValue: 'SYSDATE' },
          target: { type: 'timestamp', nullable: false, defaultValue: 'now()' } },
      ],
      indexDiffs: [], foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'ORDERS', columns: [] }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres', { sourceDialect: 'oracle' }).flatMap((s) => s.statements);
    expect(stmts.some((s) => /-- review:.*default 'SYSDATE'/i.test(s))).toBe(true);
    expect(stmts.some((s) => /SET DEFAULT SYSDATE/i.test(s))).toBe(false);
  });

  it('drops an index BEFORE dropping the column it covers (avoids cascade "index does not exist")', () => {
    const diff: TableDiff = {
      tableName: 'demo_b.ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [
        { name: 'CUSTOMER_ID', status: 'REMOVED', target: { type: 'integer', nullable: false } },
      ],
      indexDiffs: [
        { name: 'IDX_B_ORDERS_CUSTOMER', status: 'REMOVED', target: { columns: ['CUSTOMER_ID'], unique: false } },
      ],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'demo_b.ORDERS', columns: [] }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres', { targetSchema: 'demo_b' }).flatMap((s) => s.statements);
    const dropIdxIdx = stmts.findIndex((s) => /DROP INDEX .*IDX_B_ORDERS_CUSTOMER/i.test(s));
    const dropColIdx = stmts.findIndex((s) => /DROP COLUMN CUSTOMER_ID/i.test(s));
    expect(dropIdxIdx).toBeGreaterThanOrEqual(0);
    expect(dropColIdx).toBeGreaterThanOrEqual(0);
    expect(dropIdxIdx).toBeLessThan(dropColIdx);
  });

  it('non-destructive mode adds + modifies but never drops', () => {
    const removedTable: TableDiff = {
      tableName: 'OLD_T', objectType: 'TABLE', status: 'REMOVED',
      columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [], targetTable: tableSchema({ name: 'OLD_T' }),
    };
    const modified: TableDiff = {
      tableName: 'app.ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [
        { name: 'USER_ID', status: 'ADDED', source: { type: 'integer', nullable: false } },
        { name: 'CUSTOMER_ID', status: 'REMOVED', target: { type: 'integer', nullable: false } },
        { name: 'TOTAL', status: 'MODIFIED', source: { type: 'numeric(10,2)', nullable: true }, target: { type: 'numeric(12,2)', nullable: false } },
      ],
      indexDiffs: [
        { name: 'IDX_ORDERS_USER', status: 'ADDED', source: { columns: ['USER_ID'], unique: false } },
        { name: 'IDX_B_ORDERS_CUSTOMER', status: 'REMOVED', target: { columns: ['CUSTOMER_ID'], unique: false } },
      ],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'app.ORDERS', columns: [] }),
    };
    const stmts = gen.generateMigrationPlan([removedTable, modified], 'postgres', { targetSchema: 'app', nonDestructive: true })
      .flatMap((s) => s.statements);
    const joined = stmts.join('\n');
    // adds + modifies happen
    expect(joined).toMatch(/ADD COLUMN USER_ID/i);
    expect(joined).toMatch(/CREATE INDEX IDX_ORDERS_USER/i);
    expect(joined).toMatch(/ALTER COLUMN TOTAL TYPE/i);
    // nothing in the target is dropped (the only DROP TABLE allowed is the view-guard's
    // internal ON COMMIT DROP scratch table, never a real object like OLD_T)
    expect(joined).not.toMatch(/DROP COLUMN/i);
    expect(joined).not.toMatch(/DROP INDEX/i);
    expect(joined).not.toMatch(/DROP TABLE OLD_T/i);
    expect(joined).not.toMatch(/DROP TABLE app\./i);
  });

  it('the same diffs DO drop in normal (destructive) mode', () => {
    const modified: TableDiff = {
      tableName: 'app.ORDERS', objectType: 'TABLE', status: 'MODIFIED',
      columnDiffs: [{ name: 'CUSTOMER_ID', status: 'REMOVED', target: { type: 'integer', nullable: false } }],
      indexDiffs: [{ name: 'IDX_B_ORDERS_CUSTOMER', status: 'REMOVED', target: { columns: ['CUSTOMER_ID'], unique: false } }],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'app.ORDERS', columns: [] }),
    };
    const stmts = gen.generateMigrationPlan([modified], 'postgres', { targetSchema: 'app' }).flatMap((s) => s.statements).join('\n');
    expect(stmts).toMatch(/DROP COLUMN CUSTOMER_ID/i);
    expect(stmts).toMatch(/DROP INDEX/i);
  });

  it('does NOT emit pg_depend guard blocks for non-Postgres targets', () => {
    const diff: TableDiff = {
      tableName: 'ORDERS',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [
        { name: 'TOTAL', status: 'MODIFIED', source: { type: 'DECIMAL(12,2)', nullable: false }, target: { type: 'DECIMAL(10,2)', nullable: false } },
      ],
      indexDiffs: [],
      foreignKeyDiffs: [],
    };
    const stmts = gen.generateMigrationPlan([diff], 'db2').flatMap((s) => s.statements);
    expect(stmts.some((s) => s.includes('pg_depend'))).toBe(false);
    expect(stmts.some((s) => s.includes('_fs_vdep'))).toBe(false);
  });

  it('includes USING cast in Postgres ALTER COLUMN TYPE', () => {
    const diff: TableDiff = {
      tableName: 'ORDERS',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [
        { name: 'amount', status: 'MODIFIED', source: { type: 'numeric(15,2)', nullable: true }, target: { type: 'numeric(10,2)', nullable: true } },
      ],
      indexDiffs: [],
      foreignKeyDiffs: [],
      sourceTable: tableSchema({ name: 'ORDERS', columns: [{ name: 'amount', type: 'numeric(15,2)', nullable: true, primaryKey: false }] }),
    };
    const stmts = gen.generateMigrationPlan([diff], 'postgres').flatMap((s) => s.statements);
    expect(stmts.some((s) => /ALTER COLUMN amount TYPE.*USING amount::/i.test(s))).toBe(true);
  });
});
