/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * These run against a real in-memory SQLite metadata store, not a mock. The
 * things most likely to break here — the unique index that guards concurrent
 * captures, the chunked multi-row INSERTs, walking deltas backwards — are all
 * properties of the database, and a mock would assert only that the code calls
 * the methods it was written to call.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TableSchema } from '@foxschema/sql';
import { createMetadataStore } from '../database/stores/registry';
import { runMigrations } from '../database/schema';
import type { MetadataStore } from '../database/stores/types';
import { LokeeWeaveStore, chunkForBind, reconstructStates } from './lokee-weave.module';

const USER = 'u1';
const IDENTITY = {
  dialect: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'shop',
  schema: 'public',
};

let open: MetadataStore | null = null;

afterEach(async () => {
  if (open) {
    await open.close().catch(() => undefined);
    open = null;
  }
});

async function freshStore(): Promise<{ meta: MetadataStore; weave: LokeeWeaveStore }> {
  const meta = createMetadataStore({ engine: 'sqlite', path: ':memory:' });
  await meta.init();
  await runMigrations(meta);
  await meta.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    USER,
    'owner@example.com',
    'x',
    new Date().toISOString(),
  ]);
  open = meta;
  return { meta, weave: new LokeeWeaveStore(async () => meta) };
}

/** A table with the columns given as `name type nullable?` triples. */
function table(name: string, columns: Array<[string, string, boolean?]>): TableSchema {
  return {
    name,
    objectType: 'TABLE',
    columns: columns.map(([columnName, type, nullable]) => ({
      name: columnName,
      type,
      nullable: nullable ?? true,
    })),
  } as TableSchema;
}

const CUSTOMER = table('customer', [
  ['id', 'integer', false],
  ['email', 'varchar(100)'],
]);

describe('capture', () => {
  it('creates version 1 with every object in the delta', async () => {
    const { weave } = await freshStore();
    const result = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });

    expect(result.changed).toBe(true);
    expect(result.versionNumber).toBe(1);
    // container + 2 columns
    expect(result.objectCount).toBe(3);
    expect(result.changeCount).toBe(3);
  });

  it('does not create a version when nothing changed', async () => {
    const { weave, meta } = await freshStore();
    const first = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    const second = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'scan' });

    expect(second.changed).toBe(false);
    expect(second.versionId).toBe(first.versionId);
    expect(second.versionNumber).toBe(1);

    const rows = await meta.all('SELECT id FROM lokee_versions');
    expect(rows).toHaveLength(1);
  });

  it('counts repeat captures as observations rather than rows', async () => {
    // This is the branch that keeps a scheduled scan from growing the table
    // without bound — ~175k rows a year across 20 databases if it inserted.
    const { weave, meta } = await freshStore();
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'scan' });
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'scan' });

    const row = await meta.get<{ observation_count: number }>(
      'SELECT observation_count FROM lokee_versions'
    );
    expect(Number(row?.observation_count)).toBe(3);
  });

  it('writes only the changed object when one column widens', async () => {
    const { weave, meta } = await freshStore();
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });

    const widened = table('customer', [
      ['id', 'integer', false],
      ['email', 'varchar(255)'],
    ]);
    const second = await weave.capture(USER, { ...IDENTITY, tables: [widened], source: 'migrate' });

    expect(second.changed).toBe(true);
    expect(second.versionNumber).toBe(2);
    // The whole point of the design: 1 row, not 3.
    expect(second.changeCount).toBe(1);

    const delta = await meta.all<{ object_key: string; operation: string }>(
      'SELECT object_key, operation FROM lokee_version_objects WHERE version_id = ?',
      [second.versionId]
    );
    expect(delta).toEqual([{ object_key: 'column:CUSTOMER.EMAIL', operation: 'MODIFY' }]);
  });

  it('stores one body per distinct hash, shared across versions', async () => {
    const { weave, meta } = await freshStore();
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    const widened = table('customer', [
      ['id', 'integer', false],
      ['email', 'varchar(255)'],
    ]);
    await weave.capture(USER, { ...IDENTITY, tables: [widened], source: 'migrate' });

    // 3 objects at v1, one of which changed at v2 → 4 distinct bodies, not 6.
    const row = await meta.get<{ n: number }>('SELECT COUNT(*) AS n FROM lokee_objects');
    expect(Number(row?.n)).toBe(4);
  });

  it('records a DELETE and drops the object from the latest index', async () => {
    const { weave, meta } = await freshStore();
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    const trimmed = table('customer', [['id', 'integer', false]]);
    const second = await weave.capture(USER, { ...IDENTITY, tables: [trimmed], source: 'migrate' });

    const delta = await meta.all<{ object_key: string; operation: string; previous_hash: string }>(
      'SELECT object_key, operation, previous_hash FROM lokee_version_objects WHERE version_id = ?',
      [second.versionId]
    );
    expect(delta).toHaveLength(1);
    expect(delta[0]!.operation).toBe('DELETE');
    // Without previous_hash the delete cannot be walked backwards, and the
    // reconstructed history would lose the column entirely.
    expect(delta[0]!.previous_hash).toBeTruthy();

    const live = await meta.all<{ object_key: string }>(
      'SELECT object_key FROM lokee_latest_objects ORDER BY object_key'
    );
    expect(live.map((r) => r.object_key)).toEqual(['column:CUSTOMER.ID', 'table:CUSTOMER']);
  });

  it('keeps two databases on one server apart', async () => {
    const { weave, meta } = await freshStore();
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    await weave.capture(USER, {
      ...IDENTITY,
      database: 'shop_staging',
      tables: [CUSTOMER],
      source: 'manual',
    });

    const rows = await meta.all('SELECT id FROM lokee_databases');
    expect(rows).toHaveLength(2);
  });

  it('treats a second saved connection to the same database as one history', async () => {
    // Identity is the database, not the connection — so re-capturing through a
    // different saved connection continues the same history.
    const { weave, meta } = await freshStore();
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    const again = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    expect(again.changed).toBe(false);
    const rows = await meta.all('SELECT id FROM lokee_databases');
    expect(rows).toHaveLength(1);
  });

  it('carries migration attribution onto the version', async () => {
    const { weave, meta } = await freshStore();
    const result = await weave.capture(USER, {
      ...IDENTITY,
      tables: [CUSTOMER],
      source: 'migrate',
      migrationRunId: 'run-7',
    });
    const row = await meta.get<{ migration_run_id: string; author_user_id: string; source: string }>(
      'SELECT migration_run_id, author_user_id, source FROM lokee_versions WHERE id = ?',
      [result.versionId]
    );
    expect(row).toMatchObject({
      migration_run_id: 'run-7',
      author_user_id: USER,
      source: 'migrate',
    });
  });

  it('serialises concurrent captures instead of forking history', async () => {
    // Two captures racing would both read the same latest index and both
    // compute version 1; the unique index is the backstop, the lock is the fix.
    const { weave, meta } = await freshStore();
    const widened = table('customer', [
      ['id', 'integer', false],
      ['email', 'varchar(255)'],
    ]);
    const [a, b] = await Promise.all([
      weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' }),
      weave.capture(USER, { ...IDENTITY, tables: [widened], source: 'manual' }),
    ]);

    const numbers = [a.versionNumber, b.versionNumber].sort();
    expect(numbers).toEqual([1, 2]);
    const rows = await meta.all<{ version_number: number }>(
      'SELECT version_number FROM lokee_versions ORDER BY version_number'
    );
    expect(rows.map((r) => Number(r.version_number))).toEqual([1, 2]);
  });

  it('survives a schema larger than one bind batch', async () => {
    // 900 placeholders / 6 columns is 150 rows per statement; 400 columns
    // forces several batches and would fail as a single statement on SQLite.
    const { weave } = await freshStore();
    const wide = table(
      'wide',
      Array.from({ length: 400 }, (_, i) => [`c${i}`, 'integer'] as [string, string])
    );
    const result = await weave.capture(USER, { ...IDENTITY, tables: [wide], source: 'manual' });
    expect(result.objectCount).toBe(401);
    expect(result.changeCount).toBe(401);
  });
});

describe('graph', () => {
  async function threeVersions() {
    const { weave, meta } = await freshStore();
    const v1 = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    const v2 = await weave.capture(USER, {
      ...IDENTITY,
      tables: [
        table('customer', [
          ['id', 'integer', false],
          ['email', 'varchar(255)'],
        ]),
      ],
      source: 'migrate',
    });
    const v3 = await weave.capture(USER, {
      ...IDENTITY,
      tables: [
        table('customer', [
          ['id', 'integer', false],
          ['email', 'varchar(255)'],
        ]),
        table('orders', [['id', 'integer', false]]),
      ],
      source: 'migrate',
    });
    return { weave, meta, v1, v2, v3, databaseId: v1.databaseId };
  }

  it('marks each object with its status at each version', async () => {
    const { weave, databaseId, v1, v2, v3 } = await threeVersions();
    const dto = await weave.graph(USER, databaseId);

    const at = (versionId: string, key: string) =>
      dto.objects.find((o) => o.versionId === versionId && o.objectKey === key);

    expect(at(v1.versionId, 'column:CUSTOMER.EMAIL')?.status).toBe('added');
    expect(at(v2.versionId, 'column:CUSTOMER.EMAIL')?.status).toBe('modified');
    expect(at(v3.versionId, 'column:CUSTOMER.EMAIL')?.status).toBe('unchanged');
  });

  it('does not invent a node before an object existed', async () => {
    // ORDERS appears at v3; drawing it at v1 would be a fabricated history.
    const { weave, databaseId, v1, v2, v3 } = await threeVersions();
    const dto = await weave.graph(USER, databaseId);
    const orders = dto.objects.filter((o) => o.objectKey === 'table:ORDERS');

    expect(orders.map((o) => o.versionId)).toEqual([v3.versionId]);
    expect(orders[0]!.status).toBe('added');
    expect(dto.objects.some((o) => o.versionId === v1.versionId && o.objectKey === 'table:ORDERS')).toBe(
      false
    );
    expect(dto.objects.some((o) => o.versionId === v2.versionId && o.objectKey === 'table:ORDERS')).toBe(
      false
    );
  });

  it('emits a tombstone in the version where an object was dropped', async () => {
    const { weave } = await freshStore();
    const v1 = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    const v2 = await weave.capture(USER, {
      ...IDENTITY,
      tables: [table('customer', [['id', 'integer', false]])],
      source: 'migrate',
    });
    const dto = await weave.graph(USER, v1.databaseId);

    const dropped = dto.objects.filter((o) => o.objectKey === 'column:CUSTOMER.EMAIL');
    const atV2 = dropped.find((o) => o.versionId === v2.versionId);
    expect(atV2?.status).toBe('deleted');
    expect(atV2?.objectHash).toBeNull();
    // It still existed at v1 and must show there.
    expect(dropped.find((o) => o.versionId === v1.versionId)?.status).toBe('added');
  });

  it('carries real names and types, not the uppercased match key', async () => {
    // The match key is an address; using it as a name would show CUSTOMER for a
    // table actually called `customer`.
    const { weave, databaseId, v3 } = await threeVersions();
    const dto = await weave.graph(USER, databaseId);
    const node = dto.objects.find(
      (o) => o.versionId === v3.versionId && o.objectKey === 'column:CUSTOMER.EMAIL'
    );
    expect(node?.name).toBe('email');
    expect(node?.objectType).toBe('column');
  });

  it('refuses to read another user\'s database', async () => {
    const { weave, meta, databaseId } = await threeVersions();
    await meta.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
      'u2',
      'other@example.com',
      'x',
      new Date().toISOString(),
    ]);
    const dto = await weave.graph('u2', databaseId);
    expect(dto.versions).toEqual([]);
    expect(dto.objects).toEqual([]);
  });

  it('does not claim truncation on a schema that fits', async () => {
    // The flag drives a banner saying the graph is showing only part of the
    // schema. Getting it wrong on a three-object database undermines the one
    // case where it matters.
    const { weave, databaseId } = await threeVersions();
    const dto = await weave.graph(USER, databaseId);
    expect(dto.truncatedObjects).toBe(false);
  });

  it('reports totals for the whole history, not just the window', async () => {
    const { weave, databaseId } = await threeVersions();
    const dto = await weave.graph(USER, databaseId, 2);
    expect(dto.versions).toHaveLength(2);
    expect(dto.totalVersions).toBe(3);
  });

  it('lets the owner set a display name and description', async () => {
    const { weave, databaseId, v1 } = await threeVersions();
    const updated = await weave.updateVersionMeta(USER, databaseId, v1.versionId, {
      name: 'Baseline schema',
      description: 'Initial customer table',
    });
    expect(updated?.name).toBe('Baseline schema');
    expect(updated?.description).toBe('Initial customer table');

    const dto = await weave.graph(USER, databaseId);
    const row = dto.versions.find((v) => v.id === v1.versionId);
    expect(row?.name).toBe('Baseline schema');
    expect(row?.description).toBe('Initial customer table');
  });

  it('clears name/description when blanked and resolves author email', async () => {
    const { weave, databaseId, v1 } = await threeVersions();
    await weave.updateVersionMeta(USER, databaseId, v1.versionId, {
      name: 'Temp',
      description: 'Notes',
    });
    const cleared = await weave.updateVersionMeta(USER, databaseId, v1.versionId, {
      name: '  ',
      description: '',
    });
    expect(cleared?.name).toBeUndefined();
    expect(cleared?.description).toBeUndefined();

    // Capture stamps author_user_id; list/graph should surface the email.
    const listed = await weave.listVersions(USER, databaseId);
    const row = listed.find((v) => v.id === v1.versionId);
    expect(row?.author).toBe('owner@example.com');
  });
});

describe('objectsAtVersion', () => {
  it('reconstructs the state as it was, not as it is now', async () => {
    const { weave } = await freshStore();
    const v1 = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    await weave.capture(USER, {
      ...IDENTITY,
      tables: [
        table('customer', [
          ['id', 'integer', false],
          ['email', 'varchar(255)'],
        ]),
        table('orders', [['id', 'integer', false]]),
      ],
      source: 'migrate',
    });

    const atV1 = await weave.objectsAtVersion(USER, v1.databaseId, v1.versionId);
    expect([...atV1.keys()].sort()).toEqual([
      'column:CUSTOMER.EMAIL',
      'column:CUSTOMER.ID',
      'table:CUSTOMER',
    ]);
    // The old width, not the current one — this is what revert depends on.
    expect(atV1.get('column:CUSTOMER.EMAIL')?.body.dataType).toBe('varchar(100)');
  });

  it('restores an object that was later dropped', async () => {
    const { weave } = await freshStore();
    const v1 = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    await weave.capture(USER, {
      ...IDENTITY,
      tables: [table('customer', [['id', 'integer', false]])],
      source: 'migrate',
    });

    const atV1 = await weave.objectsAtVersion(USER, v1.databaseId, v1.versionId);
    expect(atV1.has('column:CUSTOMER.EMAIL')).toBe(true);
  });

  it('returns nothing for a version belonging to another database', async () => {
    const { weave } = await freshStore();
    const a = await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    const b = await weave.capture(USER, {
      ...IDENTITY,
      database: 'other',
      tables: [CUSTOMER],
      source: 'manual',
    });
    expect(await weave.objectsAtVersion(USER, b.databaseId, a.versionId)).toEqual(new Map());
  });
});

describe('collectGarbage', () => {
  it('keeps bodies that any version still references', async () => {
    const { weave } = await freshStore();
    await weave.capture(USER, { ...IDENTITY, tables: [CUSTOMER], source: 'manual' });
    await weave.capture(USER, {
      ...IDENTITY,
      tables: [
        table('customer', [
          ['id', 'integer', false],
          ['email', 'varchar(255)'],
        ]),
      ],
      source: 'migrate',
    });
    // The superseded varchar(100) body is still referenced as a previous_hash,
    // and deleting it would make the history unreadable.
    expect(await weave.collectGarbage()).toBe(0);
  });
});

describe('chunkForBind', () => {
  it('keeps every chunk under the placeholder ceiling', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    for (const chunk of chunkForBind(rows, 6)) expect(chunk.length * 6).toBeLessThanOrEqual(900);
  });

  it('loses no rows', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    expect(chunkForBind(rows, 6).flat()).toEqual(rows);
  });

  it('still emits a chunk when one row alone exceeds the ceiling', () => {
    // Better one oversized statement that may fail loudly than silently
    // dropping the row.
    expect(chunkForBind([1], 5000)).toEqual([[1]]);
  });

  it('returns nothing for no rows', () => {
    expect(chunkForBind([], 6)).toEqual([]);
  });
});

describe('reconstructStates', () => {
  it('inverts an ADD by removing the object', () => {
    const latest = new Map([['a', 'h2']]);
    const states = reconstructStates(latest, [{ id: 'v2' }, { id: 'v1' }], new Map([
      ['v2', [{ version_id: 'v2', object_key: 'a', operation: 'ADD', object_hash: 'h2', previous_hash: null, object_type: 'table' }]],
      ['v1', []],
    ]) as never);
    expect(states.get('v2')).toEqual(new Map([['a', 'h2']]));
    expect(states.get('v1')).toEqual(new Map());
  });

  it('inverts a MODIFY back to the previous hash', () => {
    const latest = new Map([['a', 'h2']]);
    const states = reconstructStates(latest, [{ id: 'v2' }, { id: 'v1' }], new Map([
      ['v2', [{ version_id: 'v2', object_key: 'a', operation: 'MODIFY', object_hash: 'h2', previous_hash: 'h1', object_type: 'table' }]],
      ['v1', []],
    ]) as never);
    expect(states.get('v1')).toEqual(new Map([['a', 'h1']]));
  });

  it('inverts a DELETE by restoring the object', () => {
    const latest = new Map<string, string>();
    const states = reconstructStates(latest, [{ id: 'v2' }, { id: 'v1' }], new Map([
      ['v2', [{ version_id: 'v2', object_key: 'a', operation: 'DELETE', object_hash: null, previous_hash: 'h1', object_type: 'table' }]],
      ['v1', []],
    ]) as never);
    expect(states.get('v2')).toEqual(new Map());
    expect(states.get('v1')).toEqual(new Map([['a', 'h1']]));
  });

  it('does not alias states between versions', () => {
    // A shared Map would let a later mutation rewrite history.
    const latest = new Map([['a', 'h1']]);
    const states = reconstructStates(latest, [{ id: 'v2' }, { id: 'v1' }], new Map([
      ['v2', []],
      ['v1', []],
    ]) as never);
    expect(states.get('v2')).not.toBe(states.get('v1'));
  });
});
